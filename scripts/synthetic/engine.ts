/**
 * 가상 예약을 누비투어 서버 함수로 넣는 부분 (DB를 쓴다).
 *
 * 예약·결제·취소·출발 처리는 서버 함수(createBooking, mockPay, requestCancel, approveCancel·rejectCancel,
 * cancelDeparture, runJobsOnce)를 그 시각(now)으로 그대로 부른다. 그래서 좌석·예약번호·수수료·상태가
 * 실제 예약과 똑같이 맞는다. 되채우기는 지난 시각으로 부르고, 서버가 "지금"으로 찍는 칸(created_at 등)을
 * 그 시각으로 옮겨 적는다(stampSince). 매일 모드는 지금 시각으로 부르고 옮겨 적지 않는다.
 */
import type { Booking } from "@prisma/client";
import { PRODUCTS } from "../../prisma/seed-data/products";
import { planDepartures } from "../../prisma/seed-lib";
import { travelerType } from "@/rules/pricing";
import { addDays, kstDate, kstDateTime } from "@/rules/time";
import { approveCancel, rejectCancel } from "@/server/admin";
import { audit } from "@/server/audit";
import { hashPassword } from "@/server/auth/password";
import { createBooking, requestCancel } from "@/server/bookings";
import { db } from "@/server/db";
import { refreshDepartureStatus } from "@/server/departures";
import { HttpError } from "@/server/http";
import { answerInquiry } from "@/server/inquiries";
import { cancelDeparture, runJobsOnce } from "@/server/jobs";
import { mockPay } from "@/server/payments";
import { createInquiry, createReview } from "@/server/support";
import { randomBytes } from "node:crypto";
import {
  CANCEL_REASONS,
  INQUIRY_KINDS,
  type Intent,
  isSynthEmail,
  MIN_PAX_INQUIRY,
  type Model,
  productOf,
  RATES,
  type RegionCode,
  REVIEW_TEXTS,
  SOLD_OUT_INQUIRY,
  SYNTH_DOMAIN,
  SYNTH_STAFF_EMAIL,
} from "./model";
import { Rng } from "./rng";

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const LIKE = `%@${SYNTH_DOMAIN}`;

// ── 사건 ──
type InquiryCategory = "booking" | "payment" | "cancel" | "product" | "etc";
export type Ev =
  | { kind: "pay"; t: number; code: string; mode: "deposit" | "full" }
  | { kind: "balance"; t: number; code: string }
  | { kind: "cancel"; t: number; code: string; guest: boolean; reason: number; reject: boolean; decideDelayH: number }
  | { kind: "decide"; t: number; code: string; reject: boolean }
  | {
      kind: "inquiry";
      t: number;
      code: string | null;
      userId: string | null;
      name: string;
      email: string;
      category: InquiryCategory;
      title: string;
      body: string;
      answer: string;
      answerDelayH: number;
      tag: "booking" | "sold_out" | "min_pax";
    }
  | { kind: "answer"; t: number; id: string; answer: string }
  | { kind: "review"; t: number; code: string; userId: string; rating: number; text: number }
  | { kind: "jobs"; t: number }
  | { kind: "minpax"; t: number; date: string };

/** 시각 순 줄 (같은 시각이면 넣은 순서). */
export class EventQueue {
  private heap: { ev: Ev; seq: number }[] = [];
  private seq = 0;

  constructor(items: Ev[] = []) {
    for (const ev of items) this.push(ev);
  }
  get size(): number {
    return this.heap.length;
  }
  push(ev: Ev): void {
    const h = this.heap;
    h.push({ ev, seq: this.seq++ });
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      [h[i], h[p]] = [h[p], h[i]];
      i = p;
    }
  }
  peek(): Ev | undefined {
    return this.heap[0]?.ev;
  }
  pop(): Ev | undefined {
    const h = this.heap;
    if (!h.length) return undefined;
    const top = h[0].ev;
    const last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && this.less(l, m)) m = l;
        if (r < h.length && this.less(r, m)) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return top;
  }
  /** 시각 순으로 모두 (저장용). */
  toArray(): Ev[] {
    return [...this.heap].sort((a, b) => a.ev.t - b.ev.t || a.seq - b.seq).map((x) => x.ev);
  }
  private less(a: number, b: number): boolean {
    const x = this.heap[a];
    const y = this.heap[b];
    return x.ev.t < y.ev.t || (x.ev.t === y.ev.t && x.seq < y.seq);
  }
}

// ── 하루 집계 ──
export interface DayStats {
  planned: number;
  inserted: number;
  members: number;
  guests: number;
  lost: number; // 후보 출발일이 모두 마감이라 못 넣음
  missed: number; // 매일 모드가 꺼져 있어 놓침
  soldOutHits: number;
  byRegion: Partial<Record<RegionCode, { planned: number; inserted: number }>>;
  followups: Record<string, number>;
}
export const emptyStats = (): DayStats => ({ planned: 0, inserted: 0, members: 0, guests: 0, lost: 0, missed: 0, soldOutHits: 0, byRegion: {}, followups: {} });

/** 넣은 예약 하나의 기록 (정답지용). */
export interface BookingRec {
  code: string;
  key: string;
  t: number;
  member: number | null;
  persona: number;
  region: RegionCode;
  product: string;
  date: string;
  lead: number;
  travelers: number;
  bookerBirth: string;
}

export interface Ctx {
  model: Model;
  staffId: string;
  userIds: Map<number, string>;
  depIds: Map<string, string>; // `${상품 코드}|${출발일}` → 출발일 id
  stats: Map<string, DayStats>;
  queue: EventQueue;
  records: BookingRec[] | null; // 되채우기만 모은다
  log: (msg: string) => void;
}

export function dayStats(ctx: Ctx, date: string): DayStats {
  let s = ctx.stats.get(date);
  if (!s) ctx.stats.set(date, (s = emptyStats()));
  return s;
}
const bump = (ctx: Ctx, t: number, what: string, n = 1) => {
  const s = dayStats(ctx, kstDate(new Date(t)));
  s.followups[what] = (s.followups[what] ?? 0) + n;
};

/** 끝난 것으로 치는 오류: 상태가 이미 바뀌었거나(취소·만료·출발 취소) 할 일이 없을 때. */
function skippable(e: unknown): e is HttpError {
  return e instanceof HttpError && e.status >= 400 && e.status < 500;
}

// ── 예약 넣기 ──
export function paxFor(travelers: Intent["travelers"], departDate: string, singleRooms: number) {
  const pax = { adults: 0, children: 0, infants: 0, single_rooms: singleRooms };
  for (const t of travelers) {
    const type = travelerType(t.birth_date, departDate);
    if (type === "adult") pax.adults++;
    else if (type === "child") pax.children++;
    else pax.infants++;
  }
  return pax;
}

const TRY_NEXT = new Set(["SOLD_OUT", "CLOSED", "NOT_FOUND", "BAD_PAX", "BAD_TRAVELERS"]);

/** 계획 하나를 예약으로. 첫 후보가 마감이면 다음 후보로. 넣은 예약을 돌려준다. */
export async function placeIntent(ctx: Ctx, intent: Intent, now: Date): Promise<Booking | null> {
  const st = dayStats(ctx, intent.day);
  const userId = intent.member === null ? null : ctx.userIds.get(intent.member) ?? null;
  if (intent.member !== null && !userId) throw new Error(`가상 회원이 DB에 없어요: ${intent.contact.email}`);
  let soldOut = false;
  let booking: Booking | null = null;
  let chosen: Intent["candidates"][number] | null = null;
  for (const c of intent.candidates) {
    const depId = ctx.depIds.get(`${c.product}|${c.date}`);
    if (!depId) continue;
    try {
      booking = await createBooking(
        {
          departure_id: depId,
          pax: paxFor(intent.travelers, c.date, intent.singleRooms),
          contact: intent.contact,
          travelers: intent.travelers,
          guest_pin: intent.guestPin ?? undefined,
          userId,
        },
        now,
      );
      chosen = c;
      break;
    } catch (e) {
      if (e instanceof HttpError && TRY_NEXT.has(e.code)) {
        if (e.code === "SOLD_OUT") soldOut = true; // 좌석 마감 (출발 취소·직원 마감은 그냥 다음 후보로)
        continue;
      }
      throw e;
    }
  }
  if (soldOut) st.soldOutHits++;
  const reg = (st.byRegion[intent.region] ??= { planned: 0, inserted: 0 });
  if (soldOut && intent.fate.soldOutInquiry) {
    ctx.queue.push({
      kind: "inquiry",
      t: now.getTime() + Math.round(intent.fate.answerDelayH * 2) * MIN + 3 * MIN,
      code: booking?.code ?? null,
      userId,
      name: intent.contact.name,
      email: intent.contact.email,
      ...SOLD_OUT_INQUIRY,
      answerDelayH: intent.fate.answerDelayH,
      tag: "sold_out",
    });
  }
  if (!booking || !chosen) {
    st.lost++;
    return null;
  }
  st.inserted++;
  reg.inserted++;
  if (userId) st.members++;
  else st.guests++;
  ctx.records?.push({
    code: booking.code,
    key: intent.key,
    t: now.getTime(),
    member: intent.member,
    persona: intent.persona,
    region: intent.region,
    product: chosen.product,
    date: chosen.date,
    lead: Math.round((kstDateTime(chosen.date).getTime() - kstDateTime(intent.day).getTime()) / DAY),
    travelers: intent.travelers.length,
    bookerBirth: intent.bookerBirth,
  });
  scheduleFollowups(ctx, intent, booking, chosen.product, chosen.date, userId, now.getTime());
  return booking;
}

/** 예약 뒤의 일을 줄에 넣는다 (예약금·잔금·취소·문의·후기, 만료 확인). */
export function scheduleFollowups(ctx: Ctx, intent: Intent, b: Booking, product: string, departDate: string, userId: string | null, t0: number): void {
  const f = intent.fate;
  const q = ctx.queue;
  const depStart = kstDateTime(departDate).getTime();
  if (f.expire) {
    q.push({ kind: "jobs", t: b.pay_deadline.getTime() + 2 * MIN });
    return;
  }
  const payAt = Math.max(t0 + MIN, Math.min(t0 + Math.round(f.payDelayMin * MIN), b.pay_deadline.getTime() - MIN));
  q.push({ kind: "pay", t: payAt, code: b.code, mode: b.pay_mode === "full" ? "full" : "deposit" });
  if (b.pay_mode === "deposit" && b.balance_deadline) {
    const dl = b.balance_deadline.getTime();
    let tb = Math.max(dl - f.balanceDaysBefore * DAY, payAt + 30 * MIN);
    if (tb >= dl) tb = dl - HOUR;
    if (tb <= payAt) tb = payAt + MIN;
    q.push({ kind: "balance", t: Math.round(tb), code: b.code });
  }
  if (f.cancel) {
    let ct: number | null = null;
    const earlyEnd = depStart - 31 * DAY;
    if (f.cancel.early && earlyEnd > payAt + DAY) ct = payAt + DAY + f.cancel.frac * (earlyEnd - payAt - DAY);
    else {
      const lo = Math.max(payAt + HOUR, depStart - 29 * DAY);
      const hi = depStart - 12 * HOUR;
      if (hi > lo) ct = lo + f.cancel.frac * (hi - lo);
    }
    if (ct !== null) {
      q.push({ kind: "cancel", t: Math.round(ct), code: b.code, guest: !userId, reason: f.cancel.reason, reject: f.cancel.reject, decideDelayH: f.cancel.decideDelayH });
    }
  }
  if (f.inquiry) {
    const start = t0 + HOUR;
    const end = Math.min(depStart - DAY, t0 + 30 * DAY);
    if (end > start) {
      const k = INQUIRY_KINDS[f.inquiry.kind];
      q.push({
        kind: "inquiry",
        t: Math.round(start + f.inquiry.frac * (end - start)),
        code: b.code,
        userId,
        name: intent.contact.name,
        email: intent.contact.email,
        category: k.category,
        title: k.title,
        body: k.body,
        answer: k.answer,
        answerDelayH: f.inquiry.answerDelayH,
        tag: "booking",
      });
    }
  }
  if (f.review && userId) {
    const days = productOf(product)?.days ?? 5;
    const back = kstDateTime(addDays(departDate, days), 9).getTime(); // 돌아온 다음 날 아침
    q.push({ kind: "review", t: Math.round(back + (f.review.daysAfter - 1) * DAY), code: b.code, userId, rating: f.review.rating, text: f.review.text });
  }
}

// ── 사건 처리 ──
export async function handle(ctx: Ctx, ev: Ev, now: Date): Promise<void> {
  try {
    switch (ev.kind) {
      case "pay":
        await mockPay(ev.code, ev.mode, now);
        bump(ctx, ev.t, ev.mode === "full" ? "paid_full" : "paid_deposit");
        return;
      case "balance":
        await mockPay(ev.code, "balance", now);
        bump(ctx, ev.t, "paid_balance");
        return;
      case "cancel": {
        const b = await requestCancel(ev.code, { kind: ev.guest ? "guest" : "customer" }, CANCEL_REASONS[ev.reason], now);
        if (b.status === "cancel_requested") {
          bump(ctx, ev.t, "cancel_requested");
          ctx.queue.push({ kind: "decide", t: ev.t + Math.round(ev.decideDelayH * HOUR), code: ev.code, reject: ev.reject });
        } else bump(ctx, ev.t, "cancelled_before_pay");
        return;
      }
      case "decide":
        if (ev.reject) {
          await rejectCancel(ev.code, ctx.staffId, "손님과 통화해 예약을 그대로 두기로 했어요.", now);
          bump(ctx, ev.t, "cancel_rejected");
          // 취소 신청 동안 잔금 차례가 지나갔으면 다시 (예약금만 낸 예약일 때만 결제된다)
          ctx.queue.push({ kind: "balance", t: ev.t + 2 * HOUR, code: ev.code });
        } else {
          await approveCancel(ev.code, ctx.staffId, {}, now);
          bump(ctx, ev.t, "cancel_approved");
        }
        return;
      case "inquiry": {
        const q = await createInquiry(
          { category: ev.category, title: ev.title, body: ev.body, booking_code: ev.code ?? undefined, name: ev.name, email: ev.email },
          { userId: ev.userId, guestCode: ev.code },
        );
        bump(ctx, ev.t, `inquiry_${ev.tag}`);
        ctx.queue.push({ kind: "answer", t: ev.t + Math.round(ev.answerDelayH * HOUR), id: q.id, answer: ev.answer });
        return;
      }
      case "answer":
        await answerInquiry(ev.id, ev.answer, `staff:${ctx.staffId}`);
        await audit(`staff:${ctx.staffId}`, "inquiry.answer", ev.id);
        bump(ctx, ev.t, "inquiry_answered");
        return;
      case "review":
        await createReview(ev.userId, { booking_code: ev.code, rating: ev.rating, body: REVIEW_TEXTS[ev.rating][ev.text] });
        bump(ctx, ev.t, "review");
        return;
      case "jobs": {
        const r = await runJobsOnce(now);
        if (r.expired) bump(ctx, ev.t, "expired", r.expired);
        if (r.completed) bump(ctx, ev.t, "completed", r.completed);
        return;
      }
      case "minpax":
        await minPaxCheck(ctx, ev.date, now);
        return;
    }
  } catch (e) {
    if (skippable(e)) {
      bump(ctx, ev.t, `skipped_${ev.kind}`);
      return;
    }
    throw e;
  }
}

/**
 * 출발 7일 전 최소 인원 확인: 예약금 이상 낸 좌석이 최소 인원보다 적으면 직원(가상 운영 담당)이 출발을 취소하고
 * 전액 환불한다(cancelDeparture). 가상이 아닌 예약이 있는 출발일은 건드리지 않는다(진짜 직원 몫).
 */
export async function minPaxCheck(ctx: Ctx, date: string, now: Date): Promise<number> {
  const ids = new Set(ctx.depIds.values());
  const deps = await db.departure.findMany({
    where: { depart_date: date, status: { notIn: ["cancelled", "departed"] } },
    include: { bookings: { select: { id: true, code: true, status: true, adults: true, children: true, contact_email: true, user_id: true } } },
  });
  let cancelled = 0;
  for (const d of deps) {
    if (!ids.has(d.id)) continue;
    const live = d.bookings.filter((b) => ["pending_deposit", "pending_full", "deposit_paid", "fully_paid", "cancel_requested"].includes(b.status));
    if (live.some((b) => !isSynthEmail(b.contact_email))) continue;
    const paid = live.filter((b) => b.status === "deposit_paid" || b.status === "fully_paid").reduce((s, b) => s + b.adults + b.children, 0);
    if (paid >= d.min_pax) continue;
    const reason = "최소 출발 인원 미달";
    const r = await cancelDeparture(d.id, ctx.staffId, reason, now);
    await audit(`staff:${ctx.staffId}`, "departure.cancel", d.id, { reason, ...r, paid_seats: paid, min_pax: d.min_pax });
    cancelled++;
    bump(ctx, now.getTime(), "departure_cancelled");
    bump(ctx, now.getTime(), "departure_cancelled_bookings", live.length);
    for (const b of live) {
      if (!new Rng(`${ctx.model.seed}:minpax:${b.code}`).chance(RATES.minPaxInquiry)) continue;
      const delay = new Rng(`${ctx.model.seed}:minpax-t:${b.code}`).uniform(1, 40);
      const full = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
      ctx.queue.push({
        kind: "inquiry",
        t: now.getTime() + Math.round(delay * HOUR),
        code: b.code,
        userId: b.user_id,
        name: full.contact_name,
        email: full.contact_email,
        ...MIN_PAX_INQUIRY,
        answerDelayH: delay / 4 + 1,
        tag: "min_pax",
      });
    }
  }
  return cancelled;
}

// ── 지난 시각으로 옮겨 적기 (되채우기) ──
/** 타임스탬프 열(timestamp without time zone, UTC 값)에 넣을 문자열. 세션 시간대와 상관없게 문자열로 넘긴다. */
const ts = (d: Date) => d.toISOString().replace("Z", "");

/**
 * `since` 이후(진짜 시계)에 서버가 "지금"으로 찍은 칸을 사건 시각 t로 옮긴다. 되채우기 동안 이 DB에 쓰는 것은
 * 이 프로세스뿐이어야 한다(앱의 주기 작업을 멈추고 돌린다). job_runs의 모의 실행 기록은 지운다.
 */
export async function stampSince(since: Date, at: Date): Promise<void> {
  const s = ts(since);
  const t = ts(at);
  const C = (col: string) => `${col} = CASE WHEN ${col} >= CAST($1 AS timestamp(3)) THEN CAST($2 AS timestamp(3)) ELSE ${col} END`;
  const W = "updated_at >= CAST($1 AS timestamp(3))";
  const U = "updated_at = CAST($2 AS timestamp(3))";
  const statements = [
    `UPDATE bookings SET ${C("created_at")}, ${U} WHERE ${W}`,
    `UPDATE travelers SET ${C("created_at")}, ${U} WHERE ${W}`,
    `UPDATE payments SET ${C("created_at")}, ${C("approved_at")}, ${U} WHERE ${W}`,
    `UPDATE cancellations SET ${C("created_at")}, ${C("decided_at")}, ${U} WHERE ${W}`,
    `UPDATE departures SET ${U} WHERE ${W}`,
    `UPDATE inquiries SET ${C("created_at")}, ${C("answered_at")}, ${U} WHERE ${W}`,
    `UPDATE reviews SET ${C("created_at")}, ${U} WHERE ${W}`,
    `UPDATE messages SET created_at = CAST($2 AS timestamp(3)) WHERE created_at >= CAST($1 AS timestamp(3))`,
    `UPDATE audit_logs SET created_at = CAST($2 AS timestamp(3)) WHERE created_at >= CAST($1 AS timestamp(3))`,
  ];
  await db.$transaction([
    ...statements.map((q) => db.$executeRawUnsafe(q, s, t)),
    db.$executeRawUnsafe(`DELETE FROM job_runs WHERE started_at >= CAST($1 AS timestamp(3))`, s),
  ]);
}

// ── 준비: 직원·회원·출발일 ──
/** 아무도 모르는 비밀번호의 해시 하나 (가상 회원·직원은 로그인할 수 없다). SYNTH_MEMBER_PASSWORD를 주면 그 값으로. */
export async function unusableHash(): Promise<string> {
  return hashPassword(process.env.SYNTH_MEMBER_PASSWORD || randomBytes(24).toString("base64url"));
}

/** 가상 운영 담당 직원 (취소 승인·출발 취소·문의 답변을 하는 사람). 비활성이라 로그인할 수 없다. */
export async function ensureStaff(): Promise<string> {
  const found = await db.staff.findUnique({ where: { email: SYNTH_STAFF_EMAIL } });
  if (found) return found.id;
  const s = await db.staff.create({
    data: { email: SYNTH_STAFF_EMAIL, name: "가상 운영 담당", role: "agent", active: false, password_hash: await unusableHash() },
  });
  return s.id;
}

export async function insertMembers(model: Model, log: (m: string) => void): Promise<void> {
  const hash = await unusableHash();
  const CHUNK = 1000;
  for (let i = 0; i < model.members.length; i += CHUNK) {
    const part = model.members.slice(i, i + CHUNK);
    await db.user.createMany({
      data: part.map((m) => ({
        email: m.email,
        password_hash: hash,
        name: m.name_ko,
        phone: m.phone,
        marketing_opt_in: m.marketing,
        created_at: new Date(m.joinedAt),
        updated_at: new Date(m.joinedAt),
      })),
      skipDuplicates: true,
    });
    if ((i / CHUNK) % 10 === 0) log(`가상 회원 ${Math.min(i + CHUNK, model.members.length).toLocaleString()}/${model.members.length.toLocaleString()}`);
  }
}

/** 회원 번호 → user id (이메일 m00001@… 의 번호). */
export async function loadUserIds(): Promise<Map<number, string>> {
  const rows = await db.user.findMany({ where: { email: { endsWith: `@${SYNTH_DOMAIN}` } }, select: { id: true, email: true } });
  const out = new Map<number, string>();
  for (const r of rows) {
    const m = /^m(\d+)@/.exec(r.email);
    if (m) out.set(Number(m[1]) - 1, r.id);
  }
  return out;
}

export async function loadDepIds(from: string, to: string): Promise<Map<string, string>> {
  const rows = await db.departure.findMany({
    where: { depart_date: { gte: from, lte: to } },
    select: { id: true, depart_date: true, product: { select: { code: true } } },
  });
  return new Map(rows.map((r) => [`${r.product.code}|${r.depart_date}`, r.id]));
}

/**
 * 시드 상품의 출발일을 seed-lib planDepartures와 같은 규칙으로 [today+from, today+to] 만든다(있으면 그대로).
 * 새로 만든 출발일과 이 범위 출발일의 created_at은 "출발 90일 전 03:00(한국 시간)"보다 늦지 않게 당긴다
 * (지난 출발일을 지금 만든 것처럼 보이지 않게). 만든 수를 돌려준다.
 */
export async function ensureDepartures(today: string, from: number, to: number): Promise<number> {
  const products = await db.product.findMany({ where: { code: { in: PRODUCTS.map((p) => p.code) } }, select: { id: true, code: true } });
  const ids = new Map(products.map((p) => [p.code, p.id]));
  let made = 0;
  for (const p of PRODUCTS) {
    const id = ids.get(p.code);
    if (!id) continue;
    const r = await db.departure.createMany({
      data: planDepartures(p, today, { from, to }).map((d) => ({ product_id: id, ...d })),
      skipDuplicates: true,
    });
    made += r.count;
  }
  const lo = addDays(today, from);
  const hi = addDays(today, to);
  const ninetyBefore = `((CAST(depart_date AS date) - 90) + TIME '03:00' - INTERVAL '9 hours')`;
  await db.$executeRawUnsafe(
    `UPDATE departures SET
       updated_at = CASE WHEN updated_at - created_at < INTERVAL '1 second' THEN LEAST(updated_at, ${ninetyBefore}) ELSE updated_at END,
       created_at = LEAST(created_at, ${ninetyBefore})
     WHERE depart_date >= $1 AND depart_date <= $2 AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.departure_id = departures.id)`,
    lo,
    hi,
  );
  return made;
}

// ── 가상 데이터 세기·지우기 ──
export async function countSynthetic(): Promise<{ users: number; bookings: number; staff: number }> {
  const [users, bookings, staff] = await Promise.all([
    db.user.count({ where: { email: { endsWith: `@${SYNTH_DOMAIN}` } } }),
    db.booking.count({ where: { contact_email: { endsWith: `@${SYNTH_DOMAIN}` } } }),
    db.staff.count({ where: { email: SYNTH_STAFF_EMAIL } }),
  ]);
  return { users, bookings, staff };
}

/**
 * 가상 데이터만 지운다 (한 트랜잭션). 가상 회원·비회원 예약자(@synth.nubi.test)의 예약과 그에 딸린 여행자·결제·환불·
 * 취소·안내 문자·문의·후기, 가상 운영 담당 직원과 그 작업 기록. 좌석 수는 가상 예약이 잡고 있던 만큼 되돌리고,
 * 가상 직원이 취소한 출발일은 다시 연 뒤 상태를 다시 계산한다. 예약번호 일련(booking_counters)은 남은 예약에 맞춘다.
 * 출발일 행 자체는 지우지 않는다(상품 달력의 일부).
 */
export async function deleteSynthetic(): Promise<Record<string, number>> {
  return db.$transaction(
    async (tx) => {
      const staff = await tx.staff.findUnique({ where: { email: SYNTH_STAFF_EMAIL } });
      const actor = staff ? `staff:${staff.id}` : "__none__";
      const B = `SELECT id FROM bookings WHERE contact_email LIKE $1 OR user_id IN (SELECT id FROM users WHERE email LIKE $1)`;
      const n: Record<string, number> = {};
      const run = async (name: string, sql: string, ...params: unknown[]) => {
        n[name] = await tx.$executeRawUnsafe(sql, ...params);
      };
      // 좌석 되돌리기 (아직 좌석을 잡고 있던 가상 예약만)
      await run(
        "departures_seats_restored",
        `UPDATE departures d SET seats_taken = GREATEST(0, d.seats_taken - s.seats)
         FROM (SELECT departure_id, SUM(adults + children)::int AS seats FROM bookings
               WHERE id IN (${B}) AND seats_released_at IS NULL GROUP BY departure_id) s
         WHERE d.id = s.departure_id`,
        LIKE,
      );
      // 가상 직원이 취소한 출발일 다시 열기
      await run(
        "departures_reopened",
        `UPDATE departures SET status = 'open' WHERE status = 'cancelled' AND id IN
           (SELECT target FROM audit_logs WHERE actor = $1 AND action = 'departure.cancel')`,
        actor,
      );
      const touched = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT DISTINCT departure_id AS id FROM bookings WHERE id IN (${B})
         UNION SELECT target AS id FROM audit_logs WHERE actor = $2 AND action = 'departure.cancel'`,
        LIKE,
        actor,
      );
      await run("reviews", `DELETE FROM reviews WHERE booking_id IN (${B}) OR user_id IN (SELECT id FROM users WHERE email LIKE $1)`, LIKE);
      await run("inquiries", `DELETE FROM inquiries WHERE booking_id IN (${B}) OR user_id IN (SELECT id FROM users WHERE email LIKE $1) OR email LIKE $1`, LIKE);
      await run("messages", `DELETE FROM messages WHERE booking_id IN (${B})`, LIKE);
      await run("refunds", `DELETE FROM payments WHERE refund_of_id IS NOT NULL AND booking_id IN (${B})`, LIKE);
      await run("payments", `DELETE FROM payments WHERE booking_id IN (${B})`, LIKE);
      await run("cancellations", `DELETE FROM cancellations WHERE booking_id IN (${B})`, LIKE);
      await run("travelers", `DELETE FROM travelers WHERE booking_id IN (${B})`, LIKE);
      await run("audit_logs", `DELETE FROM audit_logs WHERE actor = $2 OR target IN (SELECT code FROM bookings WHERE id IN (${B}))`, LIKE, actor);
      await run("bookings", `DELETE FROM bookings WHERE id IN (${B})`, LIKE);
      await run("users", `DELETE FROM users WHERE email LIKE $1`, LIKE);
      await run("staff", `DELETE FROM staff WHERE email = $1`, SYNTH_STAFF_EMAIL);
      // 예약번호 일련: 남은 예약의 가장 큰 번호로 (없으면 그날 줄을 지운다)
      await run(
        "booking_counters",
        `UPDATE booking_counters c SET last = COALESCE((SELECT MAX(CAST(SUBSTRING(code FROM 9 FOR 4) AS int)) FROM bookings WHERE SUBSTRING(code FROM 3 FOR 6) = c.day), 0)`,
      );
      await tx.$executeRawUnsafe(`DELETE FROM booking_counters WHERE last = 0`);
      // 출발일 상태 다시 계산 (cancelled·departed는 그대로: refreshDepartureStatus와 같은 규칙)
      for (const d of touched) await refreshDepartureStatus(tx, d.id);
      return n;
    },
    { timeout: 600_000, maxWait: 30_000 },
  );
}

/** 되채우기 범위의 지난 출발일 중 예약이 하나도 없는데 "출발 완료"인 것은 다시 연다(모의 주기 작업이 그 시각에 다시 닫는다). */
export async function reopenEmptyPast(from: string, until: string): Promise<number> {
  return db.$executeRawUnsafe(
    `UPDATE departures SET status = 'open' WHERE depart_date >= $1 AND depart_date <= $2 AND status = 'departed'
       AND manual_closed = false AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.departure_id = departures.id)`,
    from,
    until,
  );
}

/** 시드 상품의 created_at을 기간 시작 30일 전보다 늦지 않게 (기간 첫날부터 예약이 있으므로). */
export async function backdateProducts(before: Date): Promise<number> {
  return db.$executeRawUnsafe(
    `UPDATE products SET created_at = LEAST(created_at, CAST($1 AS timestamp(3))) WHERE code = ANY($2::text[])`,
    ts(before),
    PRODUCTS.map((p) => p.code),
  );
}

/** 앱의 주기 작업이 최근에 돌았는지 (되채우기는 앱 작업이 멈춘 동안만). */
export async function recentJobRun(withinMs: number): Promise<Date | null> {
  const r = await db.jobRun.findFirst({ where: { started_at: { gte: new Date(Date.now() - withinMs) } }, orderBy: { started_at: "desc" } });
  return r?.started_at ?? null;
}

/** 매일 모드가 다시 켜졌을 때: 넣던 중 끊긴 예약이 실제로 들어갔는지. */
export async function findPlaced(intent: Intent, since: Date): Promise<Booking | null> {
  return db.booking.findFirst({
    where: { contact_email: intent.contact.email, created_at: { gte: new Date(since.getTime() - 5000) } },
    orderBy: { created_at: "asc" },
  });
}

export async function departureOf(b: Booking): Promise<{ product: string; date: string }> {
  const d = await db.departure.findUniqueOrThrow({ where: { id: b.departure_id }, include: { product: { select: { code: true } } } });
  return { product: d.product.code, date: d.depart_date };
}

export { db };
