/**
 * 되채우기: 예약한 날 기준 지난 60일(오늘 − 60일 ~ 지금)을 한 번에 넣는다.
 * 사건(예약·결제·취소·출발 처리)을 시각 순으로 그 시각의 now로 서버 함수에 넣고, 끝나면 정답지·회원 표·
 * 매일 모드 상태를 --out에 쓴다.
 */
import { rmSync } from "node:fs";
import path from "node:path";
import { addDays, kstDate, kstDateTime } from "@/rules/time";
import {
  backdateProducts,
  countSynthetic,
  type Ctx,
  db,
  deleteSynthetic,
  emptyStats,
  ensureDepartures,
  ensureStaff,
  EventQueue,
  handle,
  insertMembers,
  loadDepIds,
  loadUserIds,
  placeIntent,
  recentJobRun,
  reopenEmptyPast,
  stampSince,
  type BookingRec,
  type DayStats,
} from "./engine";
import {
  ageAt,
  BOOKING_MAX_DAYS,
  BOOKING_MIN_DAYS,
  type DayPlan,
  GUEST_SHARE,
  JAPAN_FACTOR,
  type Model,
  PARTY_BUCKETS,
  PERSONAS,
  RATES,
  REGION_CODES,
  REGION_KO,
  SEA_PEAK_DROP,
  startEffect,
  START_EFFECT_THRESHOLD,
  SYNTH_DOMAIN,
  SYNTH_STAFF_EMAIL,
  TREND_FLOOR,
  TREND_PEAK,
  TREND_START,
  trendOn,
  WINDOW_DAYS,
  windowDays,
} from "./model";
import { csvLine, FILES, writeAtomic } from "./outdir";
import { planWindow } from "./preview";
import type { DailyState } from "./state";

const MIN = 60_000;
const DAY = 86_400_000;

export interface BackfillOptions {
  seed: number;
  out: string;
  replace: boolean;
  force: boolean;
  log: (msg: string) => void;
  /** 시험용: 회원 수 (기본 4만 명, 그중 10% 기간 안 가입). */
  members?: number;
  /** 시험용: 지금 시각. */
  now?: Date;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runBackfill(o: BackfillOptions): Promise<void> {
  const log = o.log;
  const started = o.now ?? new Date();
  const size = o.members ? { members: o.members, newMembers: Math.round(o.members / 10) } : {};
  const { today, cutoff, model, plans } = planWindow(o.seed, started, size);
  log(`기간 ${model.windowStart} ~ ${today} (예약한 날 기준), 계획 ${plans.reduce((s, p) => s + p.intents.length, 0)}건`);

  // ── 확인 ──
  const existing = await countSynthetic();
  if ((existing.users || existing.bookings || existing.staff) && !o.replace) {
    throw new Error(`이미 가상 데이터가 있어요(회원 ${existing.users}, 예약 ${existing.bookings}). 지우고 다시 넣으려면 --replace.`);
  }
  const recent = await recentJobRun(15 * MIN);
  if (recent && !o.force) {
    throw new Error(
      `앱의 주기 작업이 ${recent.toISOString()}에 돌았어요. 되채우기는 지난 시각으로 처리하므로, 그동안 앱을 멈추거나 JOBS_ENABLED=false로 켜 주세요(--force로 무시).`,
    );
  }
  if (o.replace) {
    const n = await deleteSynthetic();
    log(`가상 데이터 지움: ${JSON.stringify(n)}`);
    for (const f of [FILES.state, FILES.dailyKey]) rmSync(path.join(o.out, f), { force: true });
  }

  // ── 준비 ──
  const made = await ensureDepartures(today, -(WINDOW_DAYS - BOOKING_MIN_DAYS), BOOKING_MAX_DAYS);
  const reopened = await reopenEmptyPast(addDays(model.windowStart, BOOKING_MIN_DAYS), addDays(today, -1));
  await backdateProducts(new Date(kstDateTime(model.windowStart).getTime() - 30 * DAY));
  log(`출발일 새로 ${made}개 (${addDays(model.windowStart, BOOKING_MIN_DAYS)} ~ ${addDays(today, BOOKING_MAX_DAYS)}), 다시 연 지난 출발일 ${reopened}개`);
  const staffId = await ensureStaff();
  await insertMembers(model, log);
  const userIds = await loadUserIds();
  if (userIds.size !== model.members.length) throw new Error(`가상 회원 수가 맞지 않아요: DB ${userIds.size}, 모형 ${model.members.length}`);
  const depIds = await loadDepIds(addDays(model.windowStart, BOOKING_MIN_DAYS), addDays(today, BOOKING_MAX_DAYS));

  const records: BookingRec[] = [];
  const ctx: Ctx = { model, staffId, userIds, depIds, stats: new Map(), queue: new EventQueue(), records, log };
  const days = windowDays(model);
  for (const p of plans) {
    const s = (ctx.stats.get(p.date) ?? emptyStats()) as DayStats;
    for (const i of p.intents) {
      if (i.t > cutoff) continue;
      s.planned++;
      (s.byRegion[i.region] ??= { planned: 0, inserted: 0 }).planned++;
    }
    ctx.stats.set(p.date, s);
  }
  for (const d of days) {
    ctx.queue.push({ kind: "jobs", t: kstDateTime(d, 0, 5).getTime() }); // 출발·여행 완료·출발 확정
    ctx.queue.push({ kind: "minpax", t: kstDateTime(d, 10).getTime(), date: addDays(d, 7) }); // 출발 7일 전 최소 인원
  }
  // 기간 첫 며칠 출발일은 7일 전 확인 날이 기간 전이라, 온라인 예약이 닫힌 뒤(출발 2일 전)에 확인한다 (시작 구간 효과)
  for (let k = BOOKING_MIN_DAYS; k < 7; k++) {
    const d = addDays(model.windowStart, k);
    ctx.queue.push({ kind: "minpax", t: kstDateTime(addDays(d, -2), 10).getTime(), date: d });
  }

  // ── 시각 순으로 넣기 ──
  await sleep(2500);
  const since = new Date(Date.now() - 1000);
  const intents = plans.flatMap((p) => p.intents);
  let ii = 0;
  let steps = 0;
  const t0 = Date.now();
  for (;;) {
    const ni = ii < intents.length && intents[ii].t <= cutoff ? intents[ii] : null;
    const top = ctx.queue.peek();
    const ne = top && top.t <= cutoff ? top : null;
    if (!ni && !ne) break;
    if (ni && (!ne || ni.t <= ne.t)) {
      ii++;
      await placeIntent(ctx, ni, new Date(ni.t));
      await stampSince(since, new Date(ni.t));
    } else if (ne) {
      ctx.queue.pop();
      await handle(ctx, ne, new Date(ne.t));
      await stampSince(since, new Date(ne.t));
    }
    if (++steps % 500 === 0) log(`… ${steps}개 처리 (예약 ${records.length}건, ${kstDate(new Date((ni ?? ne)!.t))}, ${Math.round((Date.now() - t0) / 1000)}초)`);
  }
  log(`넣기 끝: 예약 ${records.length}건, 사건 ${steps}개, ${Math.round((Date.now() - t0) / 1000)}초`);

  // ── 매일 모드로 넘길 상태 ──
  const todayPlan = plans[plans.length - 1];
  const state: DailyState = {
    version: 1,
    seed: o.seed,
    windowStart: model.windowStart,
    windowEnd: today,
    cutoff,
    members: model.members.length,
    newMembers: model.members.filter((m) => m.joinedInWindow).length,
    staffId,
    days: Object.fromEntries(
      plans.map((p) => [
        p.date,
        {
          next: p.date === today ? todayPlan.intents.filter((i) => i.t <= cutoff).length : p.intents.length,
          total: p.intents.length,
          finalized: p.date < today,
          stats: ctx.stats.get(p.date) ?? emptyStats(),
        },
      ]),
    ),
    queue: ctx.queue.toArray().filter((e) => e.kind !== "jobs"),
    extendedFor: today,
    inflight: null,
    updatedAt: new Date().toISOString(),
  };

  const key = await answerKey(model, plans, ctx, records, cutoff);
  writeAtomic(path.join(o.out, FILES.answerKey), JSON.stringify(key, null, 2));
  writeAtomic(path.join(o.out, FILES.personas), personaCsv(model, records));
  writeAtomic(path.join(o.out, FILES.state), JSON.stringify(state));
  log(`정답지: ${path.join(o.out, FILES.answerKey)} (로컬 전용, 커밋·공유 금지)`);
  log(`매일 모드 상태: ${path.join(o.out, FILES.state)} (남은 일 ${state.queue.length}개)`);
}

// ── 정답지 ──
async function answerKey(model: Model, plans: DayPlan[], ctx: Ctx, records: BookingRec[], cutoff: number) {
  const rows = await db.booking.findMany({
    where: { contact_email: { endsWith: `@${SYNTH_DOMAIN}` } },
    select: {
      code: true,
      status: true,
      adults: true,
      children: true,
      infants: true,
      single_rooms: true,
      total_amount: true,
      paid_amount: true,
      pay_mode: true,
      user_id: true,
      departure: { select: { depart_date: true, status: true, product: { select: { code: true, region: { select: { code: true } } } } } },
      payments: { select: { kind: true, amount: true, status: true } },
      cancellations: { select: { requested_by: true, fee: true, refund: true, status: true, days_before: true } },
      review: { select: { rating: true } },
    },
  });
  const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  const statuses: Record<string, number> = {};
  for (const r of rows) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
  const sum = (kind: string) => rows.reduce((s, r) => s + r.payments.filter((p) => p.kind === kind && p.status === "approved").reduce((a, p) => a + p.amount, 0), 0);
  const byCustomer = (c: { requested_by: string }) => c.requested_by === "customer" || c.requested_by === "guest";
  const customer = rows.filter((r) => r.cancellations.some((c) => byCustomer(c) && c.status === "done"));
  const longHaul = (r: (typeof rows)[number]) => ["europe", "americas"].includes(r.departure.product.region.code);
  const notExpired = rows.filter((r) => r.status !== "expired");
  const reviews = rows.filter((r) => r.review);
  const completed = rows.filter((r) => r.status === "completed");

  const inquiries = await db.inquiry.groupBy({ by: ["category"], where: { email: { endsWith: `@${SYNTH_DOMAIN}` } }, _count: true });
  const staff = await db.staff.findUnique({ where: { email: SYNTH_STAFF_EMAIL } });
  const cancelledDeps = staff
    ? await db.auditLog.findMany({ where: { actor: `staff:${staff.id}`, action: "departure.cancel" }, select: { target: true, detail: true, created_at: true } })
    : [];
  const depInfo = await db.departure.findMany({
    where: { id: { in: cancelledDeps.map((c) => c.target) } },
    select: { id: true, depart_date: true, min_pax: true, product: { select: { code: true } } },
  });
  const depById = new Map(depInfo.map((d) => [d.id, d]));

  // 주간 중화권 (트렌드 2주 전부터)
  const weeks: unknown[] = [];
  for (let w = -2; ; w++) {
    const from = addDays(TREND_START, 7 * w);
    if (from > model.windowEnd) break;
    const to = addDays(from, 6);
    const inWeek = (d: string) => d >= from && d <= to;
    const ps = plans.filter((p) => inWeek(p.date));
    const recs = records.filter((r) => inWeek(kstDate(new Date(r.t))));
    const cn = recs.filter((r) => r.region === "china");
    const others = recs.filter((r) => r.region !== "china");
    const base = ps.reduce((s, p) => s + p.baseline.china, 0);
    const exp = ps.reduce((s, p) => s + p.expected.china, 0);
    const share50 = (list: BookingRec[]) => (list.length ? round3(list.filter((r) => ageAt(r.bookerBirth, r.t) >= 50).length / list.length) : null);
    weeks.push({
      week: w < 0 ? `발표 ${-w}주 전` : `발표 뒤 ${w + 1}주 차`,
      from,
      to: to > model.windowEnd ? model.windowEnd : to,
      days: ps.length,
      china_bookings: cn.length,
      china_expected_without_trend: Math.round(base * 10) / 10,
      china_multiple_model: round3(exp / Math.max(1e-9, base)),
      china_multiple_actual: round3(cn.length / Math.max(1e-9, base)),
      share_50plus_china: share50(cn),
      share_50plus_other_regions: share50(others),
    });
  }

  const se = startEffect(model.windowStart, addDays(model.windowEnd, BOOKING_MAX_DAYS));
  const seDeps = await db.departure.findMany({
    where: { depart_date: { in: [...new Set(se.rows.map((r) => r.depart_date))] } },
    select: { depart_date: true, status: true, seats_taken: true, min_pax: true, capacity: true, product: { select: { code: true } } },
  });
  const seMap = new Map(seDeps.map((d) => [`${d.product.code}|${d.depart_date}`, d]));
  const cancelledKeys = new Set(depInfo.map((d) => `${d.product.code}|${d.depart_date}`));

  const leadBy: Record<string, number[]> = {};
  for (const r of records) (leadBy[r.region] ??= []).push(r.lead);
  const sizes = [0, 0, 0, 0];
  for (const r of records) sizes[r.travelers === 1 ? 0 : r.travelers === 2 ? 1 : r.travelers <= 4 ? 2 : 3]++;

  const personaRows = PERSONAS.map((p, i) => ({
    code: p.code,
    name: p.name,
    members: model.members.filter((m) => m.persona === i).length,
    bookings_members: records.filter((r) => r.member !== null && r.persona === i).length,
    bookings_guests: records.filter((r) => r.member === null && r.persona === i).length,
    china_bookings: records.filter((r) => r.persona === i && r.region === "china").length,
  }));

  return {
    설명:
      "누비투어 가상 예약 정답지 (로컬 전용, 저장소·DB·공유 금지). AXcellent 연결 시험에서 받은 데이터가 이 값과 맞는지 본다. 기간은 예약한 날 기준.",
    meta: {
      generated_at: new Date().toISOString(),
      seed: model.seed,
      window: { start: model.windowStart, end: model.windowEnd, cutoff: new Date(cutoff).toISOString(), days: plans.length, basis: "예약한 날(KST)" },
      marker: {
        email_domain: `@${SYNTH_DOMAIN}`,
        members: `m00001@${SYNTH_DOMAIN} ~ (회원 번호 = 가입 순서)`,
        guests: `guest.<예약일>.<순번>@${SYNTH_DOMAIN} (비회원 예약자 연락 이메일)`,
        staff: `${SYNTH_STAFF_EMAIL} (비활성, 취소 승인·출발 취소·문의 답변)`,
        payments: "모두 모의 결제(method=mock)",
      },
      rules_kept: "누비투어 현재 규칙 그대로: 1인 예약금 30만 원·24시간, 잔금 출발 7일 전까지, 7일 안쪽은 전액, 출발 2일 안쪽은 온라인 예약 없음, 국외여행 표준약관 수수료.",
    },
    members: {
      total: model.members.length,
      joined_in_window: model.members.filter((m) => m.joinedInWindow).length,
      by_persona: personaRows,
    },
    bookings: {
      planned: plans.reduce((s, p) => s + p.intents.filter((i) => i.t <= cutoff).length, 0),
      inserted: rows.length,
      lost_sold_out: [...ctx.stats.values()].reduce((s, d) => s + d.lost, 0),
      members: count((r) => r.user_id !== null),
      guests: count((r) => r.user_id === null),
      guest_share: round3(count((r) => r.user_id === null) / Math.max(1, rows.length)),
      guest_share_design: GUEST_SHARE,
      travelers: rows.reduce((s, r) => s + r.adults + r.children + r.infants, 0),
      avg_party: round3(rows.reduce((s, r) => s + r.adults + r.children + r.infants, 0) / Math.max(1, rows.length)),
      party_mix: Object.fromEntries(PARTY_BUCKETS.map((b, j) => [b, round3(sizes[j] / Math.max(1, records.length))])),
      with_children_or_infants: count((r) => r.children + r.infants > 0),
      single_rooms: count((r) => r.single_rooms > 0),
      by_region: Object.fromEntries(REGION_CODES.map((rc) => [rc, { name: REGION_KO[rc], bookings: records.filter((r) => r.region === rc).length }])),
      lead_days_mean_by_region: Object.fromEntries(Object.entries(leadBy).map(([k, v]) => [k, Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10])),
      statuses,
    },
    by_day: plans.map((p) => {
      const s = ctx.stats.get(p.date);
      return {
        date: p.date,
        dow_index: round3(p.dowIndex),
        chuseok_week: p.chuseok,
        china_trend_multiple: round3(p.trend),
        region_multipliers: Object.fromEntries(Object.entries(p.multipliers).map(([k, v]) => [k, round3(v)])),
        expected: Math.round(Object.values(p.expected).reduce((a, b) => a + b, 0) * 10) / 10,
        planned: s?.planned ?? 0,
        inserted: s?.inserted ?? 0,
        lost: s?.lost ?? 0,
        by_region: s?.byRegion ?? {},
        followups: s?.followups ?? {},
      };
    }),
    payments: {
      deposit: sum("deposit"),
      balance: sum("balance"),
      full: sum("full"),
      refund: sum("refund"),
      net_paid: rows.reduce((s, r) => s + r.paid_amount, 0),
      cancellation_fees: rows.reduce((s, r) => s + r.cancellations.filter((c) => c.status === "done").reduce((a, c) => a + c.fee, 0), 0),
    },
    outcomes: {
      expired: { count: statuses.expired ?? 0, rate: round3((statuses.expired ?? 0) / Math.max(1, rows.length)), design: RATES.expire },
      customer_cancel: {
        count: customer.length,
        rate_of_not_expired: round3(customer.length / Math.max(1, notExpired.length)),
        long_haul_rate: round3(customer.filter(longHaul).length / Math.max(1, notExpired.filter(longHaul).length)),
        design: { rate: RATES.cancel, long_haul: RATES.cancelLongHaul },
        free_before_30_days: customer.filter((r) => r.cancellations.some((c) => c.status === "done" && c.days_before >= 30)).length,
        rejected_requests: rows.filter((r) => r.cancellations.some((c) => c.status === "rejected" && byCustomer(c))).length,
      },
      min_pax_cancelled_departures: cancelledDeps.map((c) => {
        const d = depById.get(c.target);
        return { product: d?.product.code, depart_date: d?.depart_date, min_pax: d?.min_pax, detail: c.detail };
      }),
      completed: completed.length,
      reviews: {
        count: reviews.length,
        rate_of_completed: round3(reviews.length / Math.max(1, completed.length)),
        avg_rating: round3(reviews.reduce((s, r) => s + (r.review?.rating ?? 0), 0) / Math.max(1, reviews.length)),
        design: { rate: RATES.review, avg: 4.4 },
      },
      inquiries: Object.fromEntries(inquiries.map((g) => [g.category, g._count])),
      inquiry_rate_design: RATES.inquiry,
    },
    trend: {
      설명: "10/20 중국 무비자 연장 발표(가정). 중화권 예약 배수 = mult(발표 뒤 경과 일수). 50~60대 부부·효도여행 유형의 반응이 가장 크다.",
      start: TREND_START,
      peak_multiple: TREND_PEAK,
      floor_multiple: TREND_FLOOR,
      curve: "1주 ×1→1.5, 2주 ×1.5→2.1, 3주 ×2.1 유지, 그 뒤 6주에 걸쳐 ×1.3까지 내려가 멈춤",
      responders: PERSONAS.map((p) => ({ code: p.code, name: p.name, level: p.cn })),
      japan_multiple_all_window: JAPAN_FACTOR,
      southeast_asia_drop_at_peak: SEA_PEAK_DROP,
      weekly_china: weeks,
    },
    start_effect: {
      name: "시작 구간 효과",
      설명:
        "예약한 날이 기간 시작 전인 예약은 만들지 않았다. 그래서 기간 앞쪽 출발일은 앞서 들어왔어야 할 예약이 빠져 좌석이 덜 차고 최소 인원 미달 취소가 실제보다 많다. 분석 확인 때는 아래 출발일을 빼고 본다.",
      threshold_missing_share: START_EFFECT_THRESHOLD,
      clear_from_by_region: se.clearFrom,
      late_min_pax_check: `기간 첫 ${BOOKING_MIN_DAYS}~6일 출발일은 7일 전 확인 날이 기간 전이라, 출발 2일 전에 최소 인원을 확인했다.`,
      departures: se.rows.map((r) => {
        const d = seMap.get(`${r.product}|${r.depart_date}`);
        return {
          ...r,
          seats_taken: d?.seats_taken ?? null,
          min_pax: d?.min_pax ?? null,
          status: d?.status ?? null,
          min_pax_cancelled: cancelledKeys.has(`${r.product}|${r.depart_date}`),
        };
      }),
    },
    checks: [
      ["연결", "예약 건수와 여행자·결제·취소가 빠짐없이 들어옴(누비투어 건수 = 받은 건수)", "/api/v1/bookings 커서로 끝까지 받기"],
      ["연결", "예약 상태가 바뀌면(잔금, 취소, 출발, 완료) 다시 들어옴", "bookings updated_at"],
      ["데이터", "10/20 다음 주부터 중화권 주간 예약이 오르고 2~3주 차에 평소의 약 2배", "trend.weekly_china"],
      ["데이터", "오른 예약자는 50대 이상 비중이 높음", "trend.weekly_china.share_50plus_china"],
      ["데이터", "추석 주 예약 감소, 일본의 처음부터 높은 몫을 트렌드로 오해하지 않기", "by_day"],
      ["마케팅", "중화권 캠페인 근거로 트렌드를 쓰되, 이미 마감된 출발일은 빼고 남은 날짜로", "캠페인 제안"],
      ["재무", "예약금·잔금·환불·취소 수수료가 맞게 잡히고, 매출은 출발 기준과 예약 기준이 구분됨", "payments"],
      ["고객지원", "최소 인원 미달 취소 출발일의 손님에게 안내·환불이 됨, 마감 문의가 트렌드 때 늘어남", "outcomes"],
      ["총괄", "중화권 급증은 장애가 아니라 수요 변화로 구분", "이상 신호 판단"],
    ].map(([dept, answer, where]) => ({ dept, answer, where })),
    trend_on_window_end: round3(trendOn(model.windowEnd)),
  };
}

function personaCsv(model: Model, records: BookingRec[]): string {
  const booked = new Map<number, number>();
  for (const r of records) if (r.member !== null) booked.set(r.member, (booked.get(r.member) ?? 0) + 1);
  const head = ["member_no", "email", "persona", "persona_name", "joined_at", "joined_in_window", "gender", "birth_date", "yearly_bookings", "china_sensitivity", ...REGION_CODES.map((r) => `w_${r}`), "bookings_in_window"];
  const lines = [csvLine(head)];
  for (const m of model.members) {
    lines.push(
      csvLine([
        m.index + 1,
        m.email,
        PERSONAS[m.persona].code,
        PERSONAS[m.persona].name,
        new Date(m.joinedAt).toISOString(),
        m.joinedInWindow,
        m.gender,
        m.birth_date,
        round3(m.yearly),
        round3(m.cnSens / model.cnNorm),
        ...m.regionW.map(round3),
        booked.get(m.index) ?? 0,
      ]),
    );
  }
  return `﻿${lines.join("\n")}\n`;
}

