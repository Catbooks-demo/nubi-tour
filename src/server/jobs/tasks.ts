import { LIVE_STATUSES } from "@/rules/status";
import { daysBefore, kstDate } from "@/rules/time";
import { lockBooking, releaseSeats, setStatus } from "../bookings";
import { db } from "../db";
import { lockDeparture, refreshDepartureStatus } from "../departures";
import { HttpError } from "../http";
import { log } from "../log";
import { alreadySent, recordMessage, won } from "../messages";
import { reconcilePending, refundTo } from "../payments";

export interface JobResult {
  ran: boolean;
  reconciled: number;
  expired: number;
  confirmed: number;
  departed: number;
  completed: number;
  balanceReminders: number;
}

const LOCK_KEY = 7101;
const EMPTY: JobResult = { ran: false, reconciled: 0, expired: 0, confirmed: 0, departed: 0, completed: 0, balanceReminders: 0 };

/**
 * 주기 작업 한 번. 다른 곳에서 이미 돌고 있으면(advisory lock을 못 잡으면) 아무것도 안 한다.
 * 예약은 하나씩 잠그고 다시 읽은 뒤 바꾼다: 그 사이 결제·취소가 먼저 끝났으면 건너뛴다.
 */
export async function runJobsOnce(now: Date = new Date()): Promise<JobResult> {
  // 0. 응답이 끊겼던 토스 결제를 토스에 물어 반영 (결제사 호출이라 트랜잭션 밖에서)
  const reconciled = await reconcilePending(now).catch((e) => {
    log.error("결제 대조 실패", { error: e instanceof Error ? e.message : String(e) });
    return 0;
  });
  const today = kstDate(now);
  const result = await db.$transaction(
    async (tx) => {
      const got = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS ok`;
      if (!got[0]?.ok) return { ...EMPTY };
      const r: JobResult = { ...EMPTY, ran: true, reconciled };

      // 1. 결제 기한 만료 (아직 결과를 모르는 토스 결제가 있는 예약은 다음 차례로)
      const overdue = await tx.booking.findMany({
        where: {
          status: { in: ["pending_deposit", "pending_full"] },
          pay_deadline: { lt: now },
          payments: { none: { status: "pending", method: "toss", toss_payment_key: { not: null } } },
        },
        select: { code: true },
      });
      for (const { code } of overdue) {
        const b = await lockBooking(tx, code);
        if ((b.status !== "pending_deposit" && b.status !== "pending_full") || b.pay_deadline >= now) continue;
        await setStatus(tx, b, "expired");
        await releaseSeats(tx, b, now);
        await recordMessage(tx, b, "deposit_expired", "예약 자동 취소", "결제 기한이 지나 예약이 자동으로 취소됐어요.");
        r.expired++;
      }

      // 2. 예약이 있는 앞으로의 출발일 상태 다시 계산
      const upcoming = await tx.departure.findMany({
        where: { depart_date: { gte: today }, status: { notIn: ["cancelled", "departed"] }, bookings: { some: {} } },
        select: { id: true, status: true },
      });
      for (const d of upcoming) {
        const next = await refreshDepartureStatus(tx, d.id);
        if (next === "confirmed" && d.status !== "confirmed") r.confirmed++;
      }

      // 3. 출발한 출발일, 여행이 끝난 예약
      r.departed = (
        await tx.departure.updateMany({
          where: { depart_date: { lt: today }, status: { notIn: ["cancelled", "departed"] } },
          data: { status: "departed" },
        })
      ).count;
      const finished = await tx.booking.findMany({
        where: { status: "fully_paid", departure: { return_date: { lt: today } } },
        select: { code: true },
      });
      for (const { code } of finished) {
        const b = await lockBooking(tx, code);
        if (b.status !== "fully_paid") continue;
        await setStatus(tx, b, "completed");
        r.completed++;
      }

      // 4. 잔금 기한 3일 전 안내 (예약마다 한 번)
      const soon = await tx.booking.findMany({
        where: { status: "deposit_paid", balance_deadline: { gt: now, lte: new Date(now.getTime() + 3 * 86_400_000) } },
      });
      for (const b of soon) {
        if (await alreadySent(tx, b.id, "balance_reminder")) continue;
        await recordMessage(
          tx, b, "balance_reminder", "잔금 결제 안내",
          `잔금 ${won(b.total_amount - b.paid_amount)}을 ${kstDate(b.balance_deadline!)}까지 결제해 주세요.`,
        );
        r.balanceReminders++;
      }
      return r;
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
  if (result.ran) {
    await db.jobRun.create({ data: { finished_at: new Date(), result: { ...result } } });
  }
  return result;
}

/** 최소 인원 미달 등 여행사 사정으로 출발 취소: 살아 있는 예약 모두 취소, 수수료 0, 낸 금액 전액 환불. */
export async function cancelDeparture(departureId: string, staffId: string, reason = "최소 출발 인원 미달", now = new Date()) {
  const toRefund = await db.$transaction(
    async (tx) => {
      // 잠금 순서는 예약 → 출발일 (결제·취소 처리와 같은 순서라 서로 기다리다 멈추지 않는다)
      await tx.$queryRaw`SELECT id FROM bookings WHERE departure_id = ${departureId} AND status = ANY(${LIVE_STATUSES}) ORDER BY id FOR UPDATE`;
      await lockDeparture(tx, departureId);
      const dep = await tx.departure.findUnique({ where: { id: departureId }, include: { product: true } });
      if (!dep) throw new HttpError(404, "NOT_FOUND", "출발일을 찾지 못했어요.");
      if (dep.status === "cancelled" || dep.status === "departed") {
        throw new HttpError(409, "BAD_STATE", "이미 취소됐거나 출발한 출발일이에요.");
      }
      await tx.departure.update({ where: { id: dep.id }, data: { status: "cancelled" } });
      // 출발일을 잠그기 전에 새로 들어온 예약까지 잠그고, 잠근 뒤의 값으로 처리한다
      await tx.$queryRaw`SELECT id FROM bookings WHERE departure_id = ${departureId} AND status = ANY(${LIVE_STATUSES}) ORDER BY id FOR UPDATE`;
      const live = await tx.booking.findMany({ where: { departure_id: dep.id, status: { in: LIVE_STATUSES } } });
      const out: string[] = [];
      for (const b of live) {
        await tx.booking.update({ where: { id: b.id }, data: { status: "cancelled" } });
        await tx.cancellation.updateMany({ where: { booking_id: b.id, status: "requested" }, data: { status: "rejected", decide_note: "출발 취소로 대체" } });
        await tx.cancellation.create({
          data: {
            booking_id: b.id, requested_by: "staff", reason: `여행사 사정: ${reason}`,
            days_before: daysBefore(dep.depart_date, now), fee_rate: 0, fee: 0, paid: b.paid_amount, refund: b.paid_amount,
            status: "done", decided_by: staffId, decided_at: now,
          },
        });
        await releaseSeats(tx, b, now);
        await recordMessage(
          tx, b, "departure_cancelled", "출발 취소 안내",
          `${dep.product.name} ${dep.depart_date} 출발이 ${reason}(으)로 취소됐어요.${b.paid_amount ? ` 낸 금액 ${won(b.paid_amount)}은 전액 환불해 드려요.` : ""} 불편을 드려 죄송해요.`,
        );
        if (b.paid_amount > 0) out.push(b.id);
      }
      return out;
    },
    { timeout: 60_000 },
  );
  let refunded = 0;
  for (const id of toRefund) {
    try {
      // 남길 금액 0: 잠근 뒤의 낸 금액 전부 (그 뒤 늦게 들어온 결제도 포함)
      refunded += await refundTo(id, 0, "여행사 사정 출발 취소");
    } catch (e) {
      log.error("출발 취소 환불 실패", { bookingId: id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { bookings: toRefund.length, refunded };
}
