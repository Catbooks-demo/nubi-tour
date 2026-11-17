import { beforeEach, describe, expect, it } from "vitest";
import { approveCancel, dashboardCounts, rejectCancel } from "@/server/admin";
import { createBooking, requestCancel } from "@/server/bookings";
import { db } from "@/server/db";
import { mockPay } from "@/server/payments";
import { resetDb } from "./helpers/db";
import { bookingInput, makeDeparture } from "./helpers/fixtures";

beforeEach(resetDb);

async function staff(role = "admin") {
  return db.staff.create({ data: { email: `${role}@nubi.test`, name: role, role, password_hash: "x" } });
}

async function requested(daysAhead = 15) {
  const { departure } = await makeDeparture({ daysAhead });
  const b = await createBooking(bookingInput(departure.id, 2)); // 총액 200만
  await mockPay(b.code, "deposit"); // 60만
  await requestCancel(b.code, { kind: "guest" }, "일정 변경");
  return { b, departure };
}

describe("취소 승인", () => {
  it("수수료대로 환불, 취소, 좌석 반환, 작업 기록", async () => {
    const s = await staff();
    const { b, departure } = await requested(15); // 15% → 수수료 30만, 환불 30만
    const r = await approveCancel(b.code, s.id);
    expect(r.refund).toBe(300_000);
    const after = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(after.status).toBe("cancelled");
    expect(after.paid_amount).toBe(300_000);
    expect((await db.departure.findUniqueOrThrow({ where: { id: departure.id } })).seats_taken).toBe(0);
    expect(await db.payment.count({ where: { booking_id: b.id, kind: "refund", status: "approved" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "cancellation.approve" } })).toBe(1);
    expect(await db.cancellation.findFirstOrThrow({ where: { booking_id: b.id } })).toMatchObject({ status: "done", fee: 300_000, refund: 300_000 });
  });

  it("수수료를 바꾸면 사유가 필요하다", async () => {
    const s = await staff();
    const { b } = await requested(15);
    await expect(approveCancel(b.code, s.id, { fee: 0 })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    const r = await approveCancel(b.code, s.id, { fee: 0, reason: "항공사 일정 변경으로 수수료 면제" });
    expect(r.refund).toBe(600_000);
  });

  it("두 번 승인할 수 없다", async () => {
    const s = await staff();
    const { b } = await requested();
    await approveCancel(b.code, s.id);
    await expect(approveCancel(b.code, s.id)).rejects.toMatchObject({ code: "BAD_STATE" });
  });
});

describe("취소 거절", () => {
  it("원래 상태로 돌아간다", async () => {
    const s = await staff();
    const { b } = await requested();
    await expect(rejectCancel(b.code, s.id, " ")).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await rejectCancel(b.code, s.id, "출발 확정 후 변경 불가 상품");
    const after = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(after.status).toBe("deposit_paid");
    expect((await db.cancellation.findFirstOrThrow({ where: { booking_id: b.id } })).status).toBe("rejected");
  });
});

describe("대시보드", () => {
  it("숫자가 데이터와 맞는다", async () => {
    await requested(); // 오늘 예약 1, 결제 60만, 취소 요청 1
    const { departure } = await makeDeparture({ daysAhead: 10 });
    const b2 = await createBooking(bookingInput(departure.id, 1));
    await mockPay(b2.code, "deposit"); // 30만, 출발 확정 대기 1 (10일 뒤, open, 결제 있음)
    await db.inquiry.create({ data: { name: "a", email: "a@x.com", category: "etc", title: "t", body: "b" } });
    const c = await dashboardCounts();
    expect(c).toMatchObject({ todayBookings: 2, todayPaid: 900_000, cancelRequests: 1, openInquiries: 1, balanceOverdue: 0 });
    expect(c.confirmPending).toBeGreaterThanOrEqual(1);
  });
});
