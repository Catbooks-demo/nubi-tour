import { addDays, kstDate, kstDateTime } from "@/rules/time";
import { audit } from "./audit";
import { lockBooking, releaseSeats } from "./bookings";
import { db } from "./db";
import { HttpError } from "./http";
import { log } from "./log";
import { recordMessage, won } from "./messages";
import { refundTo } from "./payments";

export interface DashboardCounts {
  todayBookings: number;
  todayPaid: number;
  cancelRequests: number;
  openInquiries: number;
  balanceOverdue: number;
  confirmPending: number;
}

/** 직원 대시보드 숫자. "오늘"은 한국 날짜. */
export async function dashboardCounts(now = new Date()): Promise<DashboardCounts> {
  const today = kstDate(now);
  const start = kstDateTime(today);
  const [todayBookings, paid, refunded, cancelRequests, openInquiries, balanceOverdue, confirmPending] = await Promise.all([
    db.booking.count({ where: { created_at: { gte: start } } }),
    db.payment.aggregate({ where: { status: "approved", kind: { not: "refund" }, approved_at: { gte: start } }, _sum: { amount: true } }),
    db.payment.aggregate({ where: { status: "approved", kind: "refund", approved_at: { gte: start } }, _sum: { amount: true } }),
    db.booking.count({ where: { status: "cancel_requested" } }),
    db.inquiry.count({ where: { status: "open" } }),
    db.booking.count({ where: { status: "deposit_paid", balance_deadline: { lt: now } } }),
    db.departure.count({
      where: {
        status: "open",
        depart_date: { gte: today, lte: addDays(today, 14) },
        bookings: { some: { status: { in: ["deposit_paid", "fully_paid"] } } },
      },
    }),
  ]);
  return {
    todayBookings,
    todayPaid: (paid._sum.amount ?? 0) - (refunded._sum.amount ?? 0),
    cancelRequests,
    openInquiries,
    balanceOverdue,
    confirmPending,
  };
}

/**
 * 취소 승인: 수수료(바꾸면 사유 필수) 확정 → 예약 취소 → 좌석 반환 → 안내 → 환불.
 * 환불은 결제사 호출이라 DB 처리 뒤에 한다.
 */
export async function approveCancel(code: string, staffId: string, opts: { fee?: number; reason?: string } = {}, now = new Date()) {
  const { bookingId, refundAmount, fee: keep } = await db.$transaction(async (tx) => {
    const b = await lockBooking(tx, code);
    if (b.status !== "cancel_requested") throw new HttpError(409, "BAD_STATE", "취소 요청 상태가 아니에요.");
    const c = await tx.cancellation.findFirst({ where: { booking_id: b.id, status: "requested" }, orderBy: { created_at: "desc" } });
    if (!c) throw new HttpError(409, "BAD_STATE", "처리할 취소 요청이 없어요.");
    let fee = c.fee;
    if (opts.fee !== undefined && opts.fee !== c.fee) {
      if (!Number.isInteger(opts.fee) || opts.fee < 0 || opts.fee > b.total_amount) {
        throw new HttpError(400, "BAD_FEE", "수수료는 0원 이상, 여행 요금 이하로 넣어 주세요.");
      }
      if (!opts.reason?.trim()) throw new HttpError(400, "REASON_REQUIRED", "수수료를 바꾸면 사유를 꼭 적어 주세요.");
      fee = opts.fee;
    }
    const refundAmount = Math.max(0, b.paid_amount - fee);
    await tx.cancellation.update({
      where: { id: c.id },
      data: { status: "done", fee, refund: refundAmount, paid: b.paid_amount, decided_by: staffId, decided_at: now, decide_note: opts.reason?.trim() || null },
    });
    await tx.booking.update({ where: { id: b.id }, data: { status: "cancelled" } });
    await releaseSeats(tx, b, now);
    await recordMessage(tx, b, "cancelled", "취소 완료", `예약이 취소됐어요. 취소 수수료 ${won(fee)}, 환불 ${won(refundAmount)}이에요.`);
    await audit(`staff:${staffId}`, "cancellation.approve", b.code, { fee, refund: refundAmount, changed: fee !== c.fee, reason: opts.reason ?? null }, tx);
    return { bookingId: b.id, refundAmount, fee };
  });
  try {
    await refundTo(bookingId, keep, "손님 취소 환불");
  } catch (e) {
    log.error("취소 승인 뒤 환불 실패", { code, error: e instanceof Error ? e.message : String(e) });
    throw new HttpError(502, "REFUND_FAILED", "예약은 취소했지만 환불이 실패했어요. 결제 내역을 확인하고 다시 시도해 주세요.");
  }
  return { refund: refundAmount };
}

/**
 * 미처리 환불 다시 시도: 취소 예약은 수수료만 남기고, 만료 예약(늦게 들어온 결제)은 전부 돌려준다.
 * 응답이 끊겼던 환불은 같은 멱등 키로 다시 보내므로 두 번 나가지 않는다.
 */
export async function retryRefund(code: string, staffId: string) {
  const b = await db.booking.findUnique({ where: { code }, include: { cancellations: { where: { status: "done" }, orderBy: { created_at: "desc" }, take: 1 } } });
  const keep = b?.status === "cancelled" && b.cancellations[0] ? b.cancellations[0].fee : b?.status === "expired" ? 0 : null;
  if (!b || keep === null) throw new HttpError(409, "BAD_STATE", "다시 환불할 예약이 아니에요.");
  const done = await refundTo(b.id, keep, "환불 재시도");
  await audit(`staff:${staffId}`, "refund.retry", code, { amount: done });
  return { refund: done };
}

/** 취소 거절: 원래 상태로 돌린다. */
export async function rejectCancel(code: string, staffId: string, reason: string, now = new Date()) {
  if (!reason.trim()) throw new HttpError(400, "REASON_REQUIRED", "거절 사유를 적어 주세요.");
  await db.$transaction(async (tx) => {
    const b = await lockBooking(tx, code);
    if (b.status !== "cancel_requested" || !b.status_before_cancel) throw new HttpError(409, "BAD_STATE", "취소 요청 상태가 아니에요.");
    await tx.cancellation.updateMany({
      where: { booking_id: b.id, status: "requested" },
      data: { status: "rejected", decided_by: staffId, decided_at: now, decide_note: reason.trim() },
    });
    await tx.booking.update({ where: { id: b.id }, data: { status: b.status_before_cancel, status_before_cancel: null } });
    await recordMessage(tx, b, "cancel_rejected", "취소 요청 안내", `취소 요청을 처리하지 못했어요: ${reason.trim()}`);
    await audit(`staff:${staffId}`, "cancellation.reject", b.code, { reason }, tx);
  });
}
