import { randomBytes } from "node:crypto";
import type { Booking, Payment } from "@prisma/client";
import { type BookingStatus, canTransition } from "@/rules/status";
import { lockBooking } from "../bookings";
import { db } from "../db";
import { refreshDepartureStatus } from "../departures";
import { tossEnabled } from "../env";
import { HttpError } from "../http";
import { log } from "../log";
import { recordMessage, won } from "../messages";
import type { Tx } from "../tx";
import { TossError, tossCancel, tossConfirm } from "./toss";

export type PayKind = "deposit" | "balance" | "full";

const KIND_KO: Record<PayKind, string> = { deposit: "예약금", balance: "잔금", full: "여행 요금" };

/** 이 결제를 지금 할 수 있는지 확인하고 금액을 정한다. */
function payable(b: Booking, kind: PayKind, now: Date): number {
  const expect: Record<PayKind, BookingStatus> = { deposit: "pending_deposit", full: "pending_full", balance: "deposit_paid" };
  if (b.status !== expect[kind]) throw new HttpError(409, "BAD_STATE", "지금은 이 결제를 할 수 없어요.");
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

/** 결제 준비: 금액은 서버가 정하고 대기 결제 행을 만든다. */
export async function preparePayment(code: string, kind: PayKind, method: "toss" | "mock" = "toss", now = new Date()): Promise<Prepared> {
  return db.$transaction(async (tx) => {
    const b = await lockBooking(tx, code);
    const amount = payable(b, kind, now);
    const orderId = `${b.code}-${kind}-${randomBytes(4).toString("hex")}`;
    await tx.payment.create({
      data: { booking_id: b.id, kind, method, amount, status: "pending", toss_order_id: orderId },
    });
    const dep = await tx.departure.findUniqueOrThrow({ where: { id: b.departure_id }, include: { product: true } });
    return { orderId, amount, orderName: `${dep.product.name} ${KIND_KO[kind]}`.slice(0, 100) };
  });
}

/** 승인된 결제를 예약에 반영. 이미 반영된 결제면 아무것도 안 한다. 예약을 더 받을 수 없는 상태면 false. */
async function applyApproved(tx: Tx, paymentId: string, paymentKey: string | null, now: Date): Promise<{ ok: boolean; booking: Booking; payment: Payment }> {
  const pay0 = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const b = await lockBooking(tx, (await tx.booking.findUniqueOrThrow({ where: { id: pay0.booking_id } })).code);
  const pay = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (pay.status === "approved") return { ok: true, booking: b, payment: pay };

  const approved = await tx.payment.update({
    where: { id: pay.id },
    data: { status: "approved", approved_at: now, toss_payment_key: paymentKey },
  });
  const paid = b.paid_amount + pay.amount;
  const target: BookingStatus = paid >= b.total_amount ? "fully_paid" : "deposit_paid";
  if (!canTransition(b.status as BookingStatus, target)) {
    // 기한 만료·취소된 뒤 승인이 들어온 경우: 돈은 받았으니 기록하고 바로 돌려준다(호출한 쪽이 환불).
    await tx.booking.update({ where: { id: b.id }, data: { paid_amount: paid } });
    return { ok: false, booking: b, payment: approved };
  }
  const booking = await tx.booking.update({ where: { id: b.id }, data: { paid_amount: paid, status: target } });
  await refreshDepartureStatus(tx, b.departure_id);
  await recordMessage(
    tx, booking, "payment_done", "결제 완료",
    `${KIND_KO[pay.kind as PayKind]} ${won(pay.amount)} 결제가 완료됐어요.${target === "deposit_paid" ? " 잔금은 출발 7일 전까지 결제해 주세요." : ""}`,
  );
  return { ok: true, booking, payment: approved };
}

/** 토스 결제 승인. 같은 orderId를 다시 보내면 토스를 다시 부르지 않고 결과만 돌려준다. */
export async function confirmPayment(p: { orderId: string; paymentKey: string; amount: number }, now = new Date()): Promise<Booking> {
  const pay = await db.payment.findUnique({ where: { toss_order_id: p.orderId } });
  if (!pay || pay.kind === "refund") throw new HttpError(404, "NOT_FOUND", "결제 정보를 찾지 못했어요.");
  if (pay.status === "approved") return db.booking.findUniqueOrThrow({ where: { id: pay.booking_id } });
  if (pay.amount !== p.amount) throw new HttpError(400, "AMOUNT_MISMATCH", "결제 금액이 맞지 않아요.");
  if (pay.status !== "pending") throw new HttpError(409, "BAD_STATE", "이미 끝난 결제예요.");

  try {
    await tossConfirm({ paymentKey: p.paymentKey, orderId: p.orderId, amount: p.amount });
  } catch (e) {
    if (e instanceof TossError) {
      if (e.code === "ALREADY_PROCESSED_PAYMENT") {
        // 다른 요청이 먼저 승인했다: 반영됐는지 보고 돌려준다
        const again = await db.payment.findUniqueOrThrow({ where: { id: pay.id } });
        if (again.status === "approved") return db.booking.findUniqueOrThrow({ where: { id: pay.booking_id } });
      }
      if (e.timeout) throw new HttpError(504, "PG_TIMEOUT", e.message);
      await db.payment.update({ where: { id: pay.id }, data: { status: "failed", failure_reason: `${e.code}: ${e.message}` } });
      throw new HttpError(402, "PAYMENT_FAILED", e.message);
    }
    throw e;
  }

  const r = await db.$transaction((tx) => applyApproved(tx, pay.id, p.paymentKey, now));
  if (!r.ok) {
    await refund(r.booking.id, r.payment.amount, "기한 만료·취소 뒤 들어온 결제 자동 환불");
    throw new HttpError(409, "BOOKING_CLOSED", "결제 전에 예약이 취소돼 결제 금액을 바로 환불했어요.");
  }
  return r.booking;
}

/** 모의 결제 (토스 키가 없을 때만). */
export async function mockPay(code: string, kind: PayKind, now = new Date()): Promise<Booking> {
  if (tossEnabled()) throw new HttpError(403, "MOCK_DISABLED", "모의 결제는 쓸 수 없어요.");
  const prepared = await preparePayment(code, kind, "mock", now);
  const pay = await db.payment.findUniqueOrThrow({ where: { toss_order_id: prepared.orderId } });
  const r = await db.$transaction((tx) => applyApproved(tx, pay.id, null, now));
  return r.booking;
}

/**
 * 환불: 가장 최근 승인 결제부터 거꾸로, 각 결제의 남은 환불 가능액만큼 나눠 환불 행을 만든다.
 * 토스 결제는 부분 취소 API를 부르고(멱등 키 = 환불 행 id), 모의 결제는 바로 승인.
 * 돌려준 총액을 반환한다.
 */
export async function refund(bookingId: string, amount: number, reason: string): Promise<number> {
  if (amount <= 0) return 0;
  const pays = await db.payment.findMany({
    where: { booking_id: bookingId, status: "approved", kind: { not: "refund" } },
    include: { refunds: { where: { status: "approved" } } },
    orderBy: { approved_at: "desc" },
  });
  let left = amount;
  let done = 0;
  for (const p of pays) {
    if (left <= 0) break;
    const refundable = p.amount - p.refunds.reduce((s, r) => s + r.amount, 0);
    const piece = Math.min(left, refundable);
    if (piece <= 0) continue;
    const row = await db.payment.create({
      data: { booking_id: bookingId, kind: "refund", method: p.method, amount: piece, status: "pending", refund_of_id: p.id },
    });
    try {
      if (p.method === "toss") {
        if (!p.toss_payment_key) throw new TossError("NO_PAYMENT_KEY", "결제 키가 없어요.");
        await tossCancel(p.toss_payment_key, piece, reason, row.id);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.payment.update({ where: { id: row.id }, data: { status: "failed", failure_reason: msg } });
      log.error("환불 실패", { bookingId, paymentId: p.id, amount: piece, error: msg });
      throw new HttpError(502, "REFUND_FAILED", "환불 처리 중 결제사 오류가 났어요. 잠시 후 다시 시도해 주세요.");
    }
    await db.$transaction([
      db.payment.update({ where: { id: row.id }, data: { status: "approved", approved_at: new Date() } }),
      db.booking.update({ where: { id: bookingId }, data: { paid_amount: { decrement: piece } } }),
    ]);
    left -= piece;
    done += piece;
  }
  return done;
}
