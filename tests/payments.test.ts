import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBooking, requestCancel } from "@/server/bookings";
import { db } from "@/server/db";
import { resetEnvCache } from "@/server/env";
import { confirmPayment, mockPay, preparePayment, refund } from "@/server/payments";
import { resetDb } from "./helpers/db";
import { bookingInput, makeDeparture } from "./helpers/fixtures";

function useToss(on: boolean) {
  if (on) {
    process.env.TOSS_CLIENT_KEY = "test_ck_dummy";
    process.env.TOSS_SECRET_KEY = "test_sk_dummy";
  } else {
    delete process.env.TOSS_CLIENT_KEY;
    delete process.env.TOSS_SECRET_KEY;
  }
  resetEnvCache();
}

const okFetch = () =>
  vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ status: "DONE", ...body }), { status: 200 });
  });

beforeEach(async () => {
  await resetDb();
  useToss(false);
});
afterEach(() => {
  vi.unstubAllGlobals();
  useToss(false);
});

describe("모의 결제", () => {
  it("예약금 → 잔금", async () => {
    const { departure } = await makeDeparture({ daysAhead: 40 });
    const b = await createBooking(bookingInput(departure.id, 2));
    const after = await mockPay(b.code, "deposit");
    expect(after.status).toBe("deposit_paid");
    expect(after.paid_amount).toBe(600_000);
    const done = await mockPay(b.code, "balance");
    expect(done.status).toBe("fully_paid");
    expect(done.paid_amount).toBe(2_000_000);
    expect(await db.message.count({ where: { booking_id: b.id, kind: "payment_done" } })).toBe(2);
  });

  it("상태에 맞지 않는 결제는 막는다", async () => {
    const { departure } = await makeDeparture({ daysAhead: 40 });
    const b = await createBooking(bookingInput(departure.id, 1));
    await expect(mockPay(b.code, "balance")).rejects.toMatchObject({ code: "BAD_STATE" });
    await expect(mockPay(b.code, "full")).rejects.toMatchObject({ code: "BAD_STATE" });
  });

  it("기한이 지나면 결제할 수 없다", async () => {
    const { departure } = await makeDeparture({ daysAhead: 40 });
    const b = await createBooking(bookingInput(departure.id, 1));
    await expect(mockPay(b.code, "deposit", new Date(Date.now() + 25 * 3_600_000))).rejects.toMatchObject({ code: "EXPIRED" });
  });

  it("토스 키가 있으면 모의 결제는 403", async () => {
    useToss(true);
    const { departure } = await makeDeparture();
    const b = await createBooking(bookingInput(departure.id, 1));
    await expect(mockPay(b.code, "deposit")).rejects.toMatchObject({ status: 403 });
  });

  it("예약금 결제로 최소 인원을 채우면 출발 확정", async () => {
    const { departure } = await makeDeparture({ minPax: 2 });
    const b = await createBooking(bookingInput(departure.id, 2));
    expect((await db.departure.findUniqueOrThrow({ where: { id: departure.id } })).status).toBe("open");
    await mockPay(b.code, "deposit");
    expect((await db.departure.findUniqueOrThrow({ where: { id: departure.id } })).status).toBe("confirmed");
  });
});

describe("토스 결제", () => {
  it("승인 → 같은 orderId 다시 승인해도 한 번만 기록", async () => {
    useToss(true);
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { departure } = await makeDeparture();
    const b = await createBooking(bookingInput(departure.id, 2));
    const p = await preparePayment(b.code, "deposit");
    expect(p.amount).toBe(600_000);
    const req = { orderId: p.orderId, paymentKey: "pk_test_1", amount: p.amount };
    expect((await confirmPayment(req)).status).toBe("deposit_paid");
    expect((await confirmPayment(req)).status).toBe("deposit_paid");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await db.payment.count({ where: { booking_id: b.id, status: "approved" } })).toBe(1);
    expect((await db.booking.findUniqueOrThrow({ where: { id: b.id } })).paid_amount).toBe(600_000);
  });

  it("금액을 바꾸면 400, 토스를 부르지 않는다", async () => {
    useToss(true);
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { departure } = await makeDeparture();
    const b = await createBooking(bookingInput(departure.id, 1));
    const p = await preparePayment(b.code, "deposit");
    await expect(confirmPayment({ orderId: p.orderId, paymentKey: "pk", amount: 1000 })).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("토스가 거절하면 결제 실패로 남는다", async () => {
    useToss(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "REJECT_CARD_COMPANY", message: "카드사 거절" }), { status: 400 })));
    const { departure } = await makeDeparture();
    const b = await createBooking(bookingInput(departure.id, 1));
    const p = await preparePayment(b.code, "deposit");
    await expect(confirmPayment({ orderId: p.orderId, paymentKey: "pk", amount: p.amount })).rejects.toMatchObject({ status: 402 });
    expect((await db.payment.findUniqueOrThrow({ where: { toss_order_id: p.orderId } })).status).toBe("failed");
    expect((await db.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("pending_deposit");
  });

  it("취소된 예약에 승인이 들어오면 바로 환불한다", async () => {
    useToss(true);
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { departure } = await makeDeparture();
    const b = await createBooking(bookingInput(departure.id, 1));
    const p = await preparePayment(b.code, "deposit");
    await requestCancel(b.code, { kind: "guest" }, "변심");
    await expect(confirmPayment({ orderId: p.orderId, paymentKey: "pk_late", amount: p.amount })).rejects.toMatchObject({ code: "BOOKING_CLOSED" });
    const refunds = await db.payment.findMany({ where: { booking_id: b.id, kind: "refund", status: "approved" } });
    expect(refunds.map((r) => r.amount)).toEqual([300_000]);
    expect((await db.booking.findUniqueOrThrow({ where: { id: b.id } })).paid_amount).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2); // 승인 + 취소
  });
});

describe("환불 나누기", () => {
  async function paidBooking() {
    const { departure } = await makeDeparture({ daysAhead: 40, priceAdult: 500_000 });
    const b = await createBooking(bookingInput(departure.id, 2)); // 총액 100만, 예약금 60만
    await mockPay(b.code, "deposit");
    await new Promise((r) => setTimeout(r, 10));
    await mockPay(b.code, "balance"); // 40만
    return b;
  }

  it("가장 최근 결제부터 돌려준다", async () => {
    const b = await paidBooking();
    expect(await refund(b.id, 300_000, "부분 환불")).toBe(300_000);
    const rows = await db.payment.findMany({ where: { booking_id: b.id, kind: "refund" }, include: { refund_of: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0].refund_of?.kind).toBe("balance");
  });

  it("한 결제보다 크면 나눠서 돌려준다", async () => {
    const b = await paidBooking();
    expect(await refund(b.id, 700_000, "환불")).toBe(700_000);
    const rows = await db.payment.findMany({ where: { booking_id: b.id, kind: "refund" }, include: { refund_of: true }, orderBy: { created_at: "asc" } });
    expect(rows.map((r) => [r.refund_of?.kind, r.amount])).toEqual([["balance", 400_000], ["deposit", 300_000]]);
    expect((await db.booking.findUniqueOrThrow({ where: { id: b.id } })).paid_amount).toBe(300_000);
  });

  it("낸 금액보다 많이 돌려주지 않는다", async () => {
    const b = await paidBooking();
    expect(await refund(b.id, 5_000_000, "전액")).toBe(1_000_000);
    expect(await refund(b.id, 1, "더")).toBe(0);
  });
});
