import { beforeEach, describe, expect, it } from "vitest";
import { createBooking } from "@/server/bookings";
import { db } from "@/server/db";
import { cancelDeparture, runJobsOnce } from "@/server/jobs";
import { mockPay } from "@/server/payments";
import { resetDb } from "./helpers/db";
import { bookingInput, makeDeparture } from "./helpers/fixtures";

beforeEach(resetDb);

const HOUR = 3_600_000;

describe("주기 작업", () => {
  it("기한 지난 예약은 만료, 좌석은 한 번만 돌아오고 안내도 한 번", async () => {
    const { departure } = await makeDeparture({ daysAhead: 40 });
    const b = await createBooking(bookingInput(departure.id, 2));
    const later = new Date(Date.now() + 25 * HOUR);
    const r1 = await runJobsOnce(later);
    const r2 = await runJobsOnce(later);
    expect(r1.expired).toBe(1);
    expect(r2.expired).toBe(0);
    expect((await db.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("expired");
    expect((await db.departure.findUniqueOrThrow({ where: { id: departure.id } })).seats_taken).toBe(0);
    expect(await db.message.count({ where: { booking_id: b.id, kind: "deposit_expired" } })).toBe(1);
  });

  it("기한 전이면 그대로", async () => {
    const { departure } = await makeDeparture({ daysAhead: 40 });
    const b = await createBooking(bookingInput(departure.id, 1));
    await runJobsOnce(new Date(Date.now() + 23 * HOUR));
    expect((await db.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("pending_deposit");
  });

  it("다른 곳이 잠금을 잡고 있으면 아무것도 안 한다", async () => {
    const { departure } = await makeDeparture({ daysAhead: 40 });
    await createBooking(bookingInput(departure.id, 1));
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const holder = db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7101)`;
      locked();
      await held;
    }, { timeout: 30_000 });
    await isLocked;
    const r = await runJobsOnce(new Date(Date.now() + 25 * HOUR));
    release();
    await holder;
    expect(r.ran).toBe(false);
    expect(r.expired).toBe(0);
  });

  it("잔금 기한 3일 전 안내는 한 번만", async () => {
    const { departure } = await makeDeparture({ daysAhead: 9 });
    const b = await createBooking(bookingInput(departure.id, 1));
    await mockPay(b.code, "deposit");
    await runJobsOnce();
    await runJobsOnce();
    expect(await db.message.count({ where: { booking_id: b.id, kind: "balance_reminder" } })).toBe(1);
  });

  it("귀국일이 지난 완납 예약은 여행 완료, 출발일은 출발 완료", async () => {
    const { departure } = await makeDeparture({ daysAhead: 5 });
    const b = await createBooking(bookingInput(departure.id, 1));
    await mockPay(b.code, "full");
    const r = await runJobsOnce(new Date(Date.now() + 10 * 24 * HOUR));
    expect(r.completed).toBe(1);
    expect((await db.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("completed");
    expect((await db.departure.findUniqueOrThrow({ where: { id: departure.id } })).status).toBe("departed");
  });
});

describe("출발 취소", () => {
  it("살아 있는 예약 모두 취소, 낸 금액 전액 환불", async () => {
    const { departure } = await makeDeparture({ daysAhead: 40 });
    const staff = await db.staff.create({ data: { email: "a@nubi.test", name: "a", role: "admin", password_hash: "x" } });
    const b1 = await createBooking(bookingInput(departure.id, 2));
    await mockPay(b1.code, "deposit");
    const b2 = await createBooking(bookingInput(departure.id, 1));
    const r = await cancelDeparture(departure.id, staff.id);
    expect(r).toEqual({ bookings: 1, refunded: 600_000 });
    for (const id of [b1.id, b2.id]) {
      const b = await db.booking.findUniqueOrThrow({ where: { id } });
      expect(b.status).toBe("cancelled");
      expect(b.paid_amount).toBe(0);
    }
    const d = await db.departure.findUniqueOrThrow({ where: { id: departure.id } });
    expect(d.status).toBe("cancelled");
    expect(d.seats_taken).toBe(0);
    expect(await db.message.count({ where: { kind: "departure_cancelled" } })).toBe(2);
    await expect(cancelDeparture(departure.id, staff.id)).rejects.toMatchObject({ code: "BAD_STATE" });
  });
});
