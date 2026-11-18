/**
 * 매일 모드: 되채우기 뒤 같은 회원(같은 시드로 다시 만든다)이 오늘도 예약한다. 한국 날짜 하루마다 되채우기와
 * 같은 모형(유형·요일·날 효과·트렌드 곡선을 앞으로 늘린 것)으로 계획을 세우고, 10분마다 그때까지 된 몫만
 * 지금 시각으로 서버 함수에 넣는다. 잔금·취소·승인·문의·답변·후기, 출발 7일 전 최소 인원 확인도 같은 줄에서.
 * 출발일은 날마다 오늘 + 90일까지 늘린다. 상태 파일이 있어 다시 켜도 두 번 넣지 않는다.
 */
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { addDays, kstDate, kstDateTime } from "@/rules/time";
import { runJobsOnce } from "@/server/jobs";
import {
  type Ctx,
  dayStats,
  departureOf,
  emptyStats,
  ensureDepartures,
  ensureStaff,
  EventQueue,
  findPlaced,
  handle,
  loadDepIds,
  loadUserIds,
  placeIntent,
  scheduleFollowups,
} from "./engine";
import { BOOKING_MAX_DAYS, BOOKING_MIN_DAYS, buildModel, type DayPlan, planDay } from "./model";
import { FILES, readJson, writeAtomic } from "./outdir";
import type { DailyState } from "./state";

export interface DailyOptions {
  out: string;
  intervalMin: number;
  once: boolean;
  maxLateH: number;
  log: (msg: string) => void;
}

const HOUR = 3_600_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function takeLock(file: string): void {
  if (existsSync(file)) {
    const pid = Number(readFileSync(file, "utf-8").trim());
    let alive = false;
    try {
      if (pid) {
        process.kill(pid, 0);
        alive = true;
      }
    } catch {
      alive = false;
    }
    if (alive) throw new Error(`매일 모드가 이미 돌고 있어요(pid ${pid}). 같은 --out에는 하나만.`);
  }
  writeFileSync(file, String(process.pid));
}

export async function runDaily(o: DailyOptions): Promise<void> {
  const statePath = path.join(o.out, FILES.state);
  const state = readJson<DailyState>(statePath);
  if (!state) throw new Error(`${statePath}가 없어요. 되채우기(npm run synth)를 먼저 돌려 주세요.`);
  const lock = path.join(o.out, FILES.lock);
  takeLock(lock);
  const release = () => rmSync(lock, { force: true });
  process.once("exit", release);
  try {
    await dailyLoop(o, state, statePath);
  } finally {
    release();
  }
}

async function dailyLoop(o: DailyOptions, state: DailyState, statePath: string): Promise<void> {
  const log = o.log;

  const model = buildModel({ seed: state.seed, windowEnd: state.windowEnd, cutoff: state.cutoff, members: state.members, newMembers: state.newMembers });
  const userIds = await loadUserIds();
  if (userIds.size !== model.members.length) {
    throw new Error(`DB의 가상 회원(${userIds.size})이 시드로 다시 만든 회원(${model.members.length})과 달라요. 되채우기를 다시(--replace) 해 주세요.`);
  }
  state.staffId = await ensureStaff();
  const stats = new Map(Object.entries(state.days).map(([d, s]) => [d, s.stats]));
  const ctx: Ctx = { model, staffId: state.staffId, userIds, depIds: new Map(), stats, queue: new EventQueue(state.queue), records: null, log };
  const plans = new Map<string, DayPlan>();
  const planOf = (d: string) => {
    let p = plans.get(d);
    if (!p) plans.set(d, (p = planDay(model, d)));
    return p;
  };
  let stop = false;
  const onSigint = () => {
    stop = true;
    log("멈추는 중… (이번 차례를 마치고 상태를 저장해요)");
  };
  process.once("SIGINT", onSigint);

  const save = () => {
    for (const [d, s] of ctx.stats) if (state.days[d]) state.days[d].stats = s;
    state.queue = ctx.queue.toArray();
    state.updatedAt = new Date().toISOString();
    writeAtomic(statePath, JSON.stringify(state));
  };

  const openDay = (d: string) => {
    const p = planOf(d);
    const s = emptyStats();
    s.planned = p.intents.length;
    for (const i of p.intents) (s.byRegion[i.region] ??= { planned: 0, inserted: 0 }).planned++;
    state.days[d] = { next: 0, total: p.intents.length, finalized: false, stats: s };
    ctx.stats.set(d, s);
    ctx.queue.push({ kind: "minpax", t: kstDateTime(d, 10).getTime(), date: addDays(d, 7) });
    log(`${d} 계획: 예약 ${p.intents.length}건 (중화권 배수 ×${p.trend.toFixed(2)})`);
  };

  const finalize = (d: string) => {
    const p = planOf(d);
    const s = ctx.stats.get(d) ?? emptyStats();
    const line = {
      date: d,
      seed: model.seed,
      dow_index: Math.round(p.dowIndex * 1000) / 1000,
      chuseok_week: p.chuseok,
      china_trend_multiple: Math.round(p.trend * 1000) / 1000,
      region_multipliers: p.multipliers,
      expected: Math.round(Object.values(p.expected).reduce((a, b) => a + b, 0) * 10) / 10,
      expected_by_region: Object.fromEntries(Object.entries(p.expected).map(([k, v]) => [k, Math.round(v * 10) / 10])),
      china_expected_without_trend: Math.round(p.baseline.china * 10) / 10,
      planned: p.intents.length,
      inserted: s.inserted,
      members: s.members,
      guests: s.guests,
      lost_sold_out: s.lost,
      missed: s.missed,
      sold_out_hits: s.soldOutHits,
      by_region: s.byRegion,
      followups: s.followups,
    };
    appendFileSync(path.join(o.out, FILES.dailyKey), `${JSON.stringify(line)}\n`, "utf-8");
    state.days[d].finalized = true;
    plans.delete(d);
    log(`${d} 마감: 계획 ${line.planned}건, 넣음 ${line.inserted}건, 놓침 ${line.missed}건`);
  };

  const tick = async () => {
    const now = new Date();
    const today = kstDate(now);
    // 새 날 열기
    const known = Object.keys(state.days).sort();
    for (let d = addDays(known[known.length - 1], 1); d <= today; d = addDays(d, 1)) openDay(d);
    // 출발일 늘리기 (하루 한 번)
    if (state.extendedFor !== today) {
      const made = await ensureDepartures(today, BOOKING_MIN_DAYS, BOOKING_MAX_DAYS);
      state.extendedFor = today;
      log(`출발일 ${addDays(today, BOOKING_MAX_DAYS)}까지 늘림 (새로 ${made}개)`);
    }
    ctx.depIds = await loadDepIds(addDays(today, -1), addDays(today, BOOKING_MAX_DAYS + 1));
    save();

    // 끊겼던 예약 확인
    if (state.inflight) {
      const [d] = state.inflight.key.split("#");
      const day = state.days[d];
      const intent = planOf(d).intents.find((i) => i.key === state.inflight!.key);
      if (day && intent && day.next < day.total && planOf(d).intents[day.next].key === intent.key) {
        const b = await findPlaced(intent, new Date(state.inflight.at));
        if (b) {
          const dep = await departureOf(b);
          scheduleFollowups(ctx, intent, b, dep.product, dep.date, b.user_id, b.created_at.getTime());
          const s = dayStats(ctx, d);
          s.inserted++;
          if (b.user_id) s.members++;
          else s.guests++;
          (s.byRegion[intent.region] ??= { planned: 0, inserted: 0 }).inserted++;
          day.next++;
          log(`끊겼던 예약 ${b.code}을 찾아 이어 가요`);
        }
      }
      state.inflight = null;
      save();
    }

    // 지금까지 된 몫
    let placed = 0;
    let done = 0;
    for (;;) {
      if (stop) break;
      const at = Date.now();
      let bestDay: string | null = null;
      let bestT = Infinity;
      for (const [d, s] of Object.entries(state.days)) {
        if (s.finalized || s.next >= s.total) continue;
        const t = planOf(d).intents[s.next].t;
        if (t <= at && t < bestT) {
          bestT = t;
          bestDay = d;
        }
      }
      const top = ctx.queue.peek();
      const evDue = top && top.t <= at ? top : null;
      if (!bestDay && !evDue) break;
      if (bestDay && (!evDue || bestT <= evDue.t)) {
        const day = state.days[bestDay];
        const intent = planOf(bestDay).intents[day.next];
        if (at - intent.t > o.maxLateH * HOUR) {
          dayStats(ctx, bestDay).missed++;
          day.next++;
          continue;
        }
        state.inflight = { key: intent.key, at: Date.now() };
        save();
        await placeIntent(ctx, intent, new Date());
        day.next++;
        state.inflight = null;
        save();
        placed++;
      } else if (evDue) {
        ctx.queue.pop();
        if (evDue.kind === "jobs") continue; // 주기 작업은 차례마다 돌린다
        await handle(ctx, evDue, new Date());
        done++;
        if (evDue.kind === "inquiry" || evDue.kind === "answer" || evDue.kind === "minpax") save();
      }
    }
    await runJobsOnce(new Date());

    // 끝난 날 마감
    for (const [d, s] of Object.entries(state.days)) {
      if (!s.finalized && d < today && s.next >= s.total) finalize(d);
    }
    // 오래된 날은 상태에서 뺀다 (정답 줄은 이미 썼다)
    for (const [d, s] of Object.entries(state.days)) if (s.finalized && d < addDays(today, -30)) delete state.days[d];
    for (const d of [...ctx.stats.keys()]) if (!state.days[d]) ctx.stats.delete(d);
    save();
    log(`차례 끝: 새 예약 ${placed}건, 다른 일 ${done}개, 남은 일 ${ctx.queue.size}개`);
  };

  for (;;) {
    await tick();
    if (o.once || stop) break;
    const wait = o.intervalMin * 60_000;
    for (let waited = 0; waited < wait && !stop; waited += 1000) await sleep(1000);
    if (stop) break;
  }
  process.off("SIGINT", onSigint);
}
