import { beforeEach, describe, expect, it } from "vitest";
import { GET as getBooking } from "@/app/api/bookings/[code]/route";
import { POST as lookup } from "@/app/api/bookings/lookup/route";
import { POST as createRoute } from "@/app/api/bookings/route";
import { cancellationFee } from "@/rules/cancellation";
import { resetRateLimits } from "@/server/auth/ratelimit";
import { createBooking, findBookingForGuest, previewCancel, releaseSeats, requestCancel } from "@/server/bookings";
import { db } from "@/server/db";
import { GUEST_COOKIE } from "@/server/guest";
import { resetDb } from "./helpers/db";
import { adultsList, bookingInput, contact, makeDeparture } from "./helpers/fixtures";
import { call } from "./helpers/http";

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

const seats = async (id: string) => (await db.departure.findUniqueOrThrow({ where: { id } })).seats_taken;

describe("예약 만들기", () => {
  it("40일 뒤 출발: 예약금 대기, 좌석이 잡힌다", async () => {
    const { departure } = await makeDeparture({ daysAhead: 40 });
    const b = await createBooking(bookingInput(departure.id, 2));
    expect(b.status).toBe("pending_deposit");
    expect(b.deposit_amount).toBe(600_000);
    expect(b.total_amount).toBe(2_000_000);
    expect(b.code).toMatch(/^NB\d{6}\d{4}$/);
    expect(await seats(departure.id)).toBe(2);
    expect(await db.message.count({ where: { booking_id: b.id, kind: "booking_received" } })).toBe(1);
  });

  it("5일 뒤 출발: 전액 결제 대기", async () => {
    const { departure } = await makeDeparture({ daysAhead: 5 });
    const b = await createBooking(bookingInput(departure.id, 1));
    expect(b.status).toBe("pending_full");
    expect(b.deposit_amount).toBe(b.total_amount);
  });

  it("2일 뒤 출발: 온라인 예약 불가", async () => {
    const { departure } = await makeDeparture({ daysAhead: 2 });
    await expect(createBooking(bookingInput(departure.id, 1))).rejects.toMatchObject({ code: "CLOSED" });
  });

  it("남은 좌석보다 많으면 SOLD_OUT", async () => {
    const { departure } = await makeDeparture({ capacity: 2 });
    await expect(createBooking(bookingInput(departure.id, 3))).rejects.toMatchObject({ code: "SOLD_OUT" });
    expect(await seats(departure.id)).toBe(0);
  });

  it("마지막 좌석에 두 예약이 동시에 → 하나만 성공", async () => {
    const { departure } = await makeDeparture({ capacity: 1 });
    const results = await Promise.allSettled([
      createBooking(bookingInput(departure.id, 1)),
      createBooking(bookingInput(departure.id, 1)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const d = await db.departure.findUniqueOrThrow({ where: { id: departure.id } });
    expect(d.seats_taken).toBe(1);
    expect(d.status).toBe("closed");
  });

  it("여행자 나이가 인원과 맞지 않으면 400", async () => {
    const { departure } = await makeDeparture();
    const input = bookingInput(departure.id, 2);
    input.travelers[1] = { ...input.travelers[1], birth_date: "2020-01-01" }; // 아동인데 성인 2로 신청
    await expect(createBooking(input)).rejects.toMatchObject({ code: "BAD_TRAVELERS" });
    await expect(createBooking({ ...bookingInput(departure.id, 2), travelers: adultsList(1) })).rejects.toMatchObject({ code: "BAD_TRAVELERS" });
  });

  it("비회원은 조회 비밀번호가 있어야 한다", async () => {
    const { departure } = await makeDeparture();
    await expect(createBooking({ ...bookingInput(departure.id, 1), guest_pin: undefined })).rejects.toMatchObject({ code: "PIN_REQUIRED" });
  });

  it("예약번호는 하루 안에서 겹치지 않는다", async () => {
    const { departure } = await makeDeparture({ capacity: 30 });
    const list = await Promise.all(Array.from({ length: 5 }, () => createBooking(bookingInput(departure.id, 1))));
    expect(new Set(list.map((b) => b.code)).size).toBe(5);
  });
});

describe("비회원 조회와 접근", () => {
  it("예약번호+전화+PIN이 모두 맞아야 찾는다", async () => {
    const { departure } = await makeDeparture();
    const b = await createBooking(bookingInput(departure.id, 1));
    expect(await findBookingForGuest(b.code, "010-1234-5678", "1234")).not.toBeNull();
    expect(await findBookingForGuest(b.code, contact.phone, "9999")).toBeNull();
    expect(await findBookingForGuest(b.code, "01099998888", "1234")).toBeNull();
  });

  it("조회 쿠키로만 예약을 볼 수 있다", async () => {
    const { departure } = await makeDeparture();
    const made = await call(createRoute, { body: { ...bookingInput(departure.id, 1), agree_terms: true } });
    expect(made.status).toBe(201);
    const code = made.body.booking.code as string;
    expect((await call(getBooking, { params: { code } })).status).toBe(404);
    const found = await call(lookup, { body: { code, phone: contact.phone, pin: "1234" } });
    expect(found.status).toBe(200);
    const view = await call(getBooking, { params: { code }, cookies: { [GUEST_COOKIE]: found.cookie(GUEST_COOKIE) } });
    expect(view.status).toBe(200);
    expect(JSON.stringify(view.body)).not.toContain("guest_pin");
  });
});

describe("취소", () => {
  it("결제 전 취소는 바로 취소, 좌석은 한 번만 돌아온다", async () => {
    const { departure } = await makeDeparture();
    const b = await createBooking(bookingInput(departure.id, 2));
    const c = await requestCancel(b.code, { kind: "guest" }, "일정 변경");
    expect(c.status).toBe("cancelled");
    expect(await seats(departure.id)).toBe(0);
    await db.$transaction((tx) => releaseSeats(tx, b));
    expect(await seats(departure.id)).toBe(0);
    await expect(requestCancel(b.code, { kind: "guest" }, "다시")).rejects.toMatchObject({ code: "BAD_STATE" });
  });

  it("결제한 예약은 취소 요청, 수수료를 미리 계산해 둔다", async () => {
    const { departure } = await makeDeparture({ daysAhead: 15 });
    const b = await createBooking(bookingInput(departure.id, 2));
    await db.booking.update({ where: { id: b.id }, data: { status: "deposit_paid", paid_amount: 600_000 } });
    const preview = await previewCancel(b.code);
    expect(preview.daysBefore).toBe(15);
    expect(preview.fee).toBe(cancellationFee(2_000_000, 15).fee);
    const c = await requestCancel(b.code, { kind: "customer" }, "개인 사정");
    expect(c.status).toBe("cancel_requested");
    expect(c.status_before_cancel).toBe("deposit_paid");
    const row = await db.cancellation.findFirstOrThrow({ where: { booking_id: b.id } });
    expect(row).toMatchObject({ status: "requested", fee: 300_000, refund: 300_000 });
    expect(await seats(departure.id)).toBe(2);
  });
});
