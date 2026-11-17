import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { safeNext } from "@/lib/nav";
import { retryRefund } from "@/server/admin";
import { createBooking, lockBooking, requestCancel } from "@/server/bookings";
import { db } from "@/server/db";
import { refreshDepartureStatus } from "@/server/departures";
import { resetEnvCache, getEnv } from "@/server/env";
import { guestCodeFromRequest, guestToken, GUEST_COOKIE } from "@/server/guest";
import { clientIp } from "@/server/http";
import { cancelDeparture, runJobsOnce } from "@/server/jobs";
import { confirmPayment, mockPay, preparePayment, refundTo } from "@/server/payments";
import { resetDb } from "./helpers/db";
import { bookingInput, makeDeparture } from "./helpers/fixtures";

const HOUR = 3_600_000;

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

beforeEach(async () => {
  await resetDb();
  useToss(false);
});
afterEach(() => {
  vi.unstubAllGlobals();
  useToss(false);
});

/** 다른 트랜잭션이 예약 행을 잡고 있는 동안 fn을 돌린다. */
async function whileLocked(code: string, during: () => Promise<unknown>, inLock: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<unknown>) {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let locked!: () => void;
  const isLocked = new Promise<void>((r) => (locked = r));
  const holder = db.$transaction(
    async (tx) => {
      await lockBooking(tx, code);
      locked();
      await held;
      await inLock(tx);
    },
    { timeout: 30_000 },
  );
  await isLocked;
  const p = during();
  await new Promise((r) => setTimeout(r, 300));
  release();
  await holder;
  return p;
}

describe("C1 오래된 상태로 덮어쓰지 않기", () => {
  it("만료 작업 도중 결제가 먼저 끝나면 만료시키지 않는다", async () => {
    const { departure } = await makeDeparture({ daysAhead: 40 });
    const b = await createBooking(bookingInput(departure.id, 1));
    await whileLocked(b.code, () => runJobsOnce(new Date(Date.now() + 25 * HOUR)), (tx) =>
      tx.booking.update({ where: { id: b.id }, data: { status: "deposit_paid", paid_amount: 300_000 } }),
    );
    const after = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(after.status).toBe("deposit_paid");
    expect((await db.departure.findUniqueOrThrow({ where: { id: departure.id } })).seats_taken).toBe(1);
  });

  it("출발 취소는 잠근 뒤 읽은 낸 금액을 전부 돌려준다", async () => {
    const { departure } = await makeDeparture({ daysAhead: 40 });
    const staff = await db.staff.create({ data: { email: "a@x", name: "a", role: "admin", password_hash: "x" } });
    const b = await createBooking(bookingInput(departure.id, 1));
    await mockPay(b.code, "deposit"); // 30만
    await mockPay(b.code, "balance"); // +70만 = 100만
    const r = await cancelDeparture(departure.id, staff.id);
    expect(r.refunded).toBe(1_000_000);
    expect((await db.booking.findUniqueOrThrow({ where: { id: b.id } })).paid_amount).toBe(0);
  });

  it("출발일 상태 다시 계산이 취소된 출발일을 되살리지 않는다", async () => {
    const { departure } = await makeDeparture();
    await db.departure.update({ where: { id: departure.id }, data: { status: "cancelled" } });
    await db.$transaction((tx) => refreshDepartureStatus(tx, departure.id));
    expect((await db.departure.findUniqueOrThrow({ where: { id: departure.id } })).status).toBe("cancelled");
  });
});

describe("I1·I2 상태가 맞지 않는 결제는 바로 환불", () => {
  it("취소 요청 중 들어온 잔금은 환불하고 취소 요청은 그대로", async () => {
    useToss(true);
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => new Response(JSON.stringify({ status: "DONE", ...JSON.parse(String(init?.body ?? "{}")) }), { status: 200 })));
    const { departure } = await makeDeparture({ daysAhead: 40 });
    const b = await createBooking(bookingInput(departure.id, 1));
    const dep = await preparePayment(b.code, "deposit");
    await confirmPayment({ orderId: dep.orderId, paymentKey: "pk1", amount: dep.amount });
    const bal = await preparePayment(b.code, "balance");
    await requestCancel(b.code, { kind: "guest" }, "변심");
    await expect(confirmPayment({ orderId: bal.orderId, paymentKey: "pk2", amount: bal.amount })).rejects.toMatchObject({ code: "BOOKING_CLOSED" });
    const after = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(after.status).toBe("cancel_requested");
    expect(after.paid_amount).toBe(300_000);
  });

  it("두 탭에서 낸 예약금 두 번째는 환불, 한 번만 받는다", async () => {
    useToss(true);
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => new Response(JSON.stringify({ status: "DONE", ...JSON.parse(String(init?.body ?? "{}")) }), { status: 200 })));
    const { departure } = await makeDeparture({ daysAhead: 40, priceAdult: 549_000 });
    const b = await createBooking(bookingInput(departure.id, 2)); // 총액 109.8만, 예약금 60만
    const p1 = await preparePayment(b.code, "deposit");
    const p2 = await preparePayment(b.code, "deposit");
    await confirmPayment({ orderId: p2.orderId, paymentKey: "pk2", amount: p2.amount });
    await expect(confirmPayment({ orderId: p1.orderId, paymentKey: "pk1", amount: p1.amount })).rejects.toBeTruthy();
    const after = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(after.status).toBe("deposit_paid");
    expect(after.paid_amount).toBe(600_000);
  });
});

describe("I3 승인 응답이 애매할 때", () => {
  it("이미 처리된 결제라고 하면 토스에 물어 보고 반영한다", async () => {
    useToss(true);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/confirm")) return new Response(JSON.stringify({ code: "ALREADY_PROCESSED_PAYMENT", message: "이미 처리" }), { status: 400 });
      void init;
      return new Response(JSON.stringify({ status: "DONE", orderId: current.orderId, totalAmount: current.amount, paymentKey: "pkX" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { departure } = await makeDeparture({ daysAhead: 40 });
    const b = await createBooking(bookingInput(departure.id, 1));
    const current = await preparePayment(b.code, "deposit");
    const after = await confirmPayment({ orderId: current.orderId, paymentKey: "pkX", amount: current.amount });
    expect(after.status).toBe("deposit_paid");
    expect((await db.payment.findUniqueOrThrow({ where: { toss_order_id: current.orderId } })).status).toBe("approved");
  });

  it("시간 초과면 결제 키를 남기고 대기, 주기 작업이 토스에 물어 반영한다", async () => {
    useToss(true);
    let confirmCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/confirm")) {
        confirmCalls++;
        throw new Error("timeout");
      }
      return new Response(JSON.stringify({ status: "DONE", orderId: cur.orderId, totalAmount: cur.amount, paymentKey: "pkT" }), { status: 200 });
    }));
    const { departure } = await makeDeparture({ daysAhead: 40 });
    const b = await createBooking(bookingInput(departure.id, 1));
    const cur = await preparePayment(b.code, "deposit");
    await expect(confirmPayment({ orderId: cur.orderId, paymentKey: "pkT", amount: cur.amount })).rejects.toMatchObject({ status: 504 });
    const row = await db.payment.findUniqueOrThrow({ where: { toss_order_id: cur.orderId } });
    expect(row.status).toBe("pending");
    expect(row.toss_payment_key).toBe("pkT");
    await runJobsOnce(new Date(Date.now() + 25 * HOUR));
    expect((await db.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("deposit_paid");
    expect(confirmCalls).toBe(1);
  });
});

describe("I4 환불을 두 번 하지 않기", () => {
  it("같은 목표로 동시에 두 번 불러도 한 번만 돌려준다", async () => {
    const { departure } = await makeDeparture({ daysAhead: 40 });
    const b = await createBooking(bookingInput(departure.id, 2));
    await mockPay(b.code, "deposit"); // 60만
    const [a, c] = await Promise.all([refundTo(b.id, 200_000, "부분"), refundTo(b.id, 200_000, "부분")]);
    expect(a + c).toBe(400_000);
    expect((await db.booking.findUniqueOrThrow({ where: { id: b.id } })).paid_amount).toBe(200_000);
  });

  it("토스 취소가 시간 초과면 같은 멱등 키로 다시 보낸다", async () => {
    useToss(true);
    const keys: string[] = [];
    let cancelCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/cancel")) {
        keys.push(String((init?.headers as Record<string, string>)["Idempotency-Key"]));
        if (++cancelCalls === 1) throw new Error("timeout");
        return new Response("{}", { status: 200 });
      }
      return new Response(JSON.stringify({ status: "DONE", ...JSON.parse(String(init?.body ?? "{}")) }), { status: 200 });
    }));
    const staff = await db.staff.create({ data: { email: "a@x", name: "a", role: "admin", password_hash: "x" } });
    const { departure } = await makeDeparture({ daysAhead: 40 });
    const b = await createBooking(bookingInput(departure.id, 1));
    const p = await preparePayment(b.code, "deposit");
    await confirmPayment({ orderId: p.orderId, paymentKey: "pk", amount: p.amount });
    await expect(cancelDeparture(departure.id, staff.id)).resolves.toMatchObject({ refunded: 0 });
    await retryRefund(b.code, staff.id);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect((await db.booking.findUniqueOrThrow({ where: { id: b.id } })).paid_amount).toBe(0);
  });
});

describe("I5 직원 마감은 유지된다", () => {
  it("다시 계산해도 마감 그대로, 예약도 막힌다", async () => {
    const { departure } = await makeDeparture({ capacity: 20 });
    await db.departure.update({ where: { id: departure.id }, data: { status: "closed", manual_closed: true } });
    await db.$transaction((tx) => refreshDepartureStatus(tx, departure.id));
    expect((await db.departure.findUniqueOrThrow({ where: { id: departure.id } })).status).toBe("closed");
    await expect(createBooking(bookingInput(departure.id, 1))).rejects.toMatchObject({ code: "CLOSED" });
  });
});

describe("I6 비회원 쿠키", () => {
  it("2시간 지난 조회 쿠키는 받지 않는다", () => {
    const req = (v: string) => new Request("http://x/", { headers: { cookie: `${GUEST_COOKIE}=${v}` } });
    expect(guestCodeFromRequest(req(guestToken("NB2611170001")))).toBe("NB2611170001");
    const old = guestToken("NB2611170001", new Date(Date.now() - 3 * HOUR));
    expect(guestCodeFromRequest(req(old))).toBeNull();
  });

  it("운영 환경에서 짧은 SESSION_SECRET이면 켜지지 않는다", () => {
    const keep = { env: process.env.NODE_ENV, secret: process.env.SESSION_SECRET };
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "short");
    resetEnvCache();
    expect(() => getEnv()).toThrow();
    vi.unstubAllEnvs();
    resetEnvCache();
    void keep;
  });
});

describe("I7·M1", () => {
  it("IP는 프록시가 붙인 마지막 값을 쓴다", () => {
    const r = new Request("http://x/", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.9" } });
    expect(clientIp(r)).toBe("10.0.0.9");
  });

  it("로그인 뒤 이동은 우리 사이트 안으로만", () => {
    expect(safeNext("/my")).toBe("/my");
    expect(safeNext("//evil.com")).toBe("/my");
    expect(safeNext("/\\evil.com")).toBe("/my");
    expect(safeNext("https://evil.com")).toBe("/my");
    expect(safeNext(undefined)).toBe("/my");
  });
});
