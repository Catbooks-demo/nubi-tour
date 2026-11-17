import { randomBytes } from "node:crypto";
import type { Booking, Payment } from "@prisma/client";
import type { BookingStatus } from "@/rules/status";
import { lockBooking } from "../bookings";
import { db } from "../db";
import { refreshDepartureStatus } from "../departures";
import { tossEnabled } from "../env";
import { HttpError } from "../http";
import { log } from "../log";
import { recordMessage, won } from "../messages";
import type { Tx } from "../tx";
import { TossError, tossCancel, tossConfirm, tossLookup } from "./toss";

export type PayKind = "deposit" | "balance" | "full";

const KIND_KO: Record<PayKind, string> = { deposit: "예약금", balance: "잔금", full: "여행 요금" };
/** 결제 종류마다 예약이 있어야 하는 상태. 다르면 그 결제는 받을 수 없다. */
const EXPECT: Record<PayKind, BookingStatus> = { deposit: "pending_deposit", full: "pending_full", balance: "deposit_paid" };

/** 이 결제를 지금 할 수 있는지 확인하고 금액을 정한다. */
function payable(b: Booking, kind: PayKind, now: Date): number {
  if (b.status !== EXPECT[kind]) throw new HttpError(409, "BAD_STATE", "지금은 이 결제를 할 수 없어요.");
  if (kind !== "balance" && b.pay_deadline < now) {
    throw new HttpError(409, "EXPIRED", "결제 기한이 지났어요. 다시 예약해 주세요.");
  }
  const amount = kind === "deposit" ? b.deposit_amount : kind === "full" ? b.total_amount : b.total_amount - b.paid_amount;
  if (amount <= 0) throw new HttpError(409, "NOTHING_TO_PAY", "결제할 금액이 없어요.");
  return amount;
}

export interface Prepared {
  orderId: string;
  amount: number;
  orderName: string;
}

/** 결제 준비: 금액은 서버가 정하고 대기 결제 행을 만든다. 같은 예약의 예전 대기 결제는 무효로 한다. */
export async function preparePayment(code: string, kind: PayKind, method: "toss" | "mock" = "toss", now = new Date()): Promise<Prepared> {
  return db.$transaction(async (tx) => {
    const b = await lockBooking(tx, code);
    const amount = payable(b, kind, now);
    // 토스에 승인을 보내 결과를 기다리는 행(결제 키 있음)은 두고, 창만 열었던 행은 무효
    await tx.payment.updateMany({
      where: { booking_id: b.id, status: "pending", kind: { not: "refund" }, toss_payment_key: null },
      data: { status: "cancelled", failure_reason: "새 결제 준비로 무효" },
    });
    const orderId = `${b.code}-${kind}-${randomBytes(4).toString("hex")}`;
    await tx.payment.create({
      data: { booking_id: b.id, kind, method, amount, status: "pending", toss_order_id: orderId },
    });
    const dep = await tx.departure.findUniqueOrThrow({ where: { id: b.departure_id }, include: { product: true } });
    return { orderId, amount, orderName: `${dep.product.name} ${KIND_KO[kind]}`.slice(0, 100) };
  });
}

/**
 * 승인된 결제를 예약에 반영. 이미 반영된 결제면 아무것도 안 한다.
 * 예약이 이 결제를 받을 상태가 아니면(취소·만료·중복 결제) 돈만 기록하고 ok=false (호출한 쪽이 바로 환불).
 */
async function applyApproved(tx: Tx, paymentId: string, paymentKey: string | null, now: Date): Promise<{ ok: boolean; booking: Booking; payment: Payment }> {
  const pay0 = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const b = await lockBooking(tx, (await tx.booking.findUniqueOrThrow({ where: { id: pay0.booking_id } })).code);
  const pay = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (pay.status === "approved") return { ok: true, booking: b, payment: pay };

  const approved = await tx.payment.update({
    where: { id: pay.id },
    data: { status: "approved", approved_at: now, toss_payment_key: paymentKey ?? pay.toss_payment_key, failure_reason: null },
  });
  const paid = b.paid_amount + pay.amount;
  const kind = pay.kind as PayKind;
  if (b.status !== EXPECT[kind] || paid > b.total_amount) {
    const booking = await tx.booking.update({ where: { id: b.id }, data: { paid_amount: paid } });
    return { ok: false, booking, payment: approved };
  }
  const target: BookingStatus = paid >= b.total_amount ? "fully_paid" : "deposit_paid";
  const booking = await tx.booking.update({ where: { id: b.id }, data: { paid_amount: paid, status: target } });
  await refreshDepartureStatus(tx, b.departure_id);
  await recordMessage(
    tx, booking, "payment_done", "결제 완료",
    `${KIND_KO[kind]} ${won(pay.amount)} 결제가 완료됐어요.${target === "deposit_paid" ? " 잔금은 출발 7일 전까지 결제해 주세요." : ""}`,
  );
  return { ok: true, booking, payment: approved };
}

/** 승인 반영 → 받을 수 없는 결제면 그 금액만 바로 돌려주고 409. */
async function finishApproved(paymentId: string, paymentKey: string | null, now: Date): Promise<Booking> {
  const r = await db.$transaction((tx) => applyApproved(tx, paymentId, paymentKey, now));
  if (r.ok) return r.booking;
  await refundTo(r.booking.id, r.booking.paid_amount - r.payment.amount, "받을 수 없는 결제 자동 환불");
  throw new HttpError(409, "BOOKING_CLOSED", "예약 상태가 바뀌어 이 결제는 받을 수 없어요. 결제 금액은 바로 환불했어요.");
}

/** 토스에 실제 승인됐는지 물어 본다 (결과를 모를 때). */
async function approvedAtToss(paymentKey: string, orderId: string, amount: number): Promise<boolean | null> {
  try {
    const t = await tossLookup(paymentKey);
    return t.status === "DONE" && t.orderId === orderId && t.totalAmount === amount;
  } catch {
    return null; // 조회도 안 됨: 아직 모름
  }
}

/**
 * 토스 결제 승인. 같은 orderId를 다시 보내면 토스를 다시 부르지 않는다.
 * 응답이 끊기거나 "이미 처리됨"이면 토스에 조회해 실제 결과대로 반영한다. 모르면 대기로 두고 주기 작업이 다시 확인한다.
 */
export async function confirmPayment(p: { orderId: string; paymentKey: string; amount: number }, now = new Date()): Promise<Booking> {
  const pay = await db.payment.findUnique({ where: { toss_order_id: p.orderId } });
  if (!pay || pay.kind === "refund") throw new HttpError(404, "NOT_FOUND", "결제 정보를 찾지 못했어요.");
  if (pay.status === "approved") return db.booking.findUniqueOrThrow({ where: { id: pay.booking_id } });
  if (pay.amount !== p.amount) throw new HttpError(400, "AMOUNT_MISMATCH", "결제 금액이 맞지 않아요.");
  if (pay.status !== "pending") throw new HttpError(409, "BAD_STATE", "이미 끝났거나 무효가 된 결제예요. 예약에서 다시 결제해 주세요.");

  try {
    await tossConfirm({ paymentKey: p.paymentKey, orderId: p.orderId, amount: p.amount });
  } catch (e) {
    if (!(e instanceof TossError)) throw e;
    if (e.timeout || e.code === "ALREADY_PROCESSED_PAYMENT") {
      // 결제 키를 남겨 두면 주기 작업도 나중에 확인할 수 있다
      await db.payment.updateMany({ where: { id: pay.id, status: "pending" }, data: { toss_payment_key: p.paymentKey } });
      const done = await approvedAtToss(p.paymentKey, p.orderId, p.amount);
      if (done) return finishApproved(pay.id, p.paymentKey, now);
      const again = await db.payment.findUniqueOrThrow({ where: { id: pay.id } });
      if (again.status === "approved") return db.booking.findUniqueOrThrow({ where: { id: pay.booking_id } });
      if (done === null || e.timeout) throw new HttpError(504, "PG_TIMEOUT", "결제 결과를 아직 확인하지 못했어요. 잠시 뒤 예약 상세에서 다시 확인해 주세요.");
    }
    // 아직 대기인 행만 실패로 (다른 요청이 먼저 승인했으면 건드리지 않음)
    await db.payment.updateMany({ where: { id: pay.id, status: "pending" }, data: { status: "failed", failure_reason: `${e.code}: ${e.message}` } });
    const after = await db.payment.findUniqueOrThrow({ where: { id: pay.id } });
    if (after.status === "approved") return db.booking.findUniqueOrThrow({ where: { id: pay.booking_id } });
    throw new HttpError(402, "PAYMENT_FAILED", e.message);
  }
  return finishApproved(pay.id, p.paymentKey, now);
}

/** 응답이 끊긴 채 남은 토스 결제를 토스에 물어 정리한다 (주기 작업). 반영한 수를 돌려준다. */
export async function reconcilePending(now = new Date()): Promise<number> {
  const stuck = await db.payment.findMany({
    where: { status: "pending", method: "toss", kind: { not: "refund" }, toss_payment_key: { not: null }, created_at: { lt: new Date(now.getTime() - 60_000) } },
  });
  let n = 0;
  for (const p of stuck) {
    const done = await approvedAtToss(p.toss_payment_key!, p.toss_order_id!, p.amount);
    if (done === null) continue;
    if (done) {
      try {
        await finishApproved(p.id, p.toss_payment_key, now);
      } catch (e) {
        if (!(e instanceof HttpError && e.code === "BOOKING_CLOSED")) throw e;
      }
      n++;
    } else {
      await db.payment.updateMany({ where: { id: p.id, status: "pending" }, data: { status: "failed", failure_reason: "토스에서 승인되지 않음" } });
    }
  }
  return n;
}

/** 모의 결제 (토스 키가 없을 때만). */
export async function mockPay(code: string, kind: PayKind, now = new Date()): Promise<Booking> {
  if (tossEnabled()) throw new HttpError(403, "MOCK_DISABLED", "모의 결제는 쓸 수 없어요.");
  const prepared = await preparePayment(code, kind, "mock", now);
  const pay = await db.payment.findUniqueOrThrow({ where: { toss_order_id: prepared.orderId } });
  return finishApproved(pay.id, null, now);
}

/**
 * 환불의 바탕. 예약마다 한 번에 하나만 돈다(advisory lock). 잠근 뒤 낸 금액을 다시 읽어 얼마를 돌려줄지 정한다.
 * - 결과를 모르는 채 남은 환불 행(토스 응답 끊김)은 같은 멱등 키(행 id)로 먼저 다시 보낸다.
 * - 새 환불은 가장 최근 승인 결제부터 거꾸로, 남은 환불 가능액만큼 나눈다.
 * - 토스 응답이 끊기면 행을 대기로 남기고(다음에 같은 키로 다시) 502.
 * 돌려준 총액을 반환한다.
 */
async function refundCore(bookingId: string, want: (paid: number) => number, reason: string): Promise<number> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`refund:${bookingId}`}))`;
      let done = 0;

      // 1. 대기로 남은 환불 다시 보내기
      const stuck = await db.payment.findMany({ where: { booking_id: bookingId, kind: "refund", status: "pending" }, include: { refund_of: true } });
      for (const row of stuck) {
        done += await sendRefund(row.id, row.amount, row.refund_of!, reason, bookingId);
      }

      // 2. 더 돌려줄 금액
      const b = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
      let left = Math.min(want(b.paid_amount), b.paid_amount);
      if (left <= 0) return done;
      const pays = await db.payment.findMany({
        where: { booking_id: bookingId, status: "approved", kind: { not: "refund" } },
        include: { refunds: { where: { status: { in: ["approved", "pending"] } } } },
        orderBy: { approved_at: "desc" },
      });
      for (const p of pays) {
        if (left <= 0) break;
        const refundable = p.amount - p.refunds.reduce((s, r) => s + r.amount, 0);
        const piece = Math.min(left, refundable);
        if (piece <= 0) continue;
        const row = await db.payment.create({
          data: { booking_id: bookingId, kind: "refund", method: p.method, amount: piece, status: "pending", refund_of_id: p.id },
        });
        done += await sendRefund(row.id, piece, p, reason, bookingId);
        left -= piece;
      }
      return done;
    },
    { timeout: 120_000, maxWait: 60_000 },
  );
}

/** 환불 행 하나를 결제사에 보내고 반영. 멱등 키 = 환불 행 id. */
async function sendRefund(rowId: string, amount: number, original: Payment, reason: string, bookingId: string): Promise<number> {
  if (original.method === "toss") {
    try {
      if (!original.toss_payment_key) throw new TossError("NO_PAYMENT_KEY", "결제 키가 없어요.");
      await tossCancel(original.toss_payment_key, amount, reason, rowId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof TossError && e.timeout) {
        await db.payment.update({ where: { id: rowId }, data: { failure_reason: `응답 없음, 다시 시도 필요: ${msg}` } });
      } else {
        await db.payment.update({ where: { id: rowId }, data: { status: "failed", failure_reason: msg } });
      }
      log.error("환불 실패", { bookingId, paymentId: original.id, amount, error: msg });
      throw new HttpError(502, "REFUND_FAILED", "환불 처리 중 결제사 오류가 났어요. 잠시 후 다시 시도해 주세요.");
    }
  }
  await db.$transaction([
    db.payment.update({ where: { id: rowId }, data: { status: "approved", approved_at: new Date(), failure_reason: null } }),
    db.booking.update({ where: { id: bookingId }, data: { paid_amount: { decrement: amount } } }),
  ]);
  return amount;
}

/** 정한 금액만큼 환불 (낸 금액을 넘지 않음). */
export function refund(bookingId: string, amount: number, reason: string): Promise<number> {
  return refundCore(bookingId, () => amount, reason);
}

/** 낸 금액이 keep만 남도록 환불. 같은 목표로 두 번 불러도 한 번만 돌려준다. */
export function refundTo(bookingId: string, keep: number, reason: string): Promise<number> {
  return refundCore(bookingId, (paid) => paid - Math.max(0, keep), reason);
}
