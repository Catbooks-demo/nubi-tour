import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "@/server/auth/password";
import { createBooking } from "@/server/bookings";
import { db } from "@/server/db";
import { createInquiry, createReview } from "@/server/support";
import { resetDb } from "./helpers/db";
import { bookingInput, makeDeparture } from "./helpers/fixtures";

beforeEach(resetDb);

async function member(email = "m@nubi.test") {
  return db.user.create({ data: { email, name: "회원", phone: "01011112222", password_hash: await hashPassword("pass-1234") } });
}

describe("후기", () => {
  it("여행을 마친 본인 예약만, 한 번만", async () => {
    const u = await member();
    const other = await member("o@nubi.test");
    const { departure } = await makeDeparture();
    const b = await createBooking({ ...bookingInput(departure.id, 1), userId: u.id, guest_pin: undefined });
    const input = { booking_code: b.code, rating: 5, body: "가이드님이 친절하고 일정이 알찼어요." };
    await expect(createReview(u.id, input)).rejects.toMatchObject({ status: 403 });
    await db.booking.update({ where: { id: b.id }, data: { status: "completed" } });
    await expect(createReview(other.id, input)).rejects.toMatchObject({ status: 404 });
    await createReview(u.id, input);
    await expect(createReview(u.id, input)).rejects.toMatchObject({ status: 409 });
    expect(await db.review.count()).toBe(1);
  });
});

describe("1:1 문의", () => {
  it("회원은 회원 정보로, 비회원은 이름·이메일 필수", async () => {
    const u = await member();
    const q = await createInquiry({ category: "product", title: "문의", body: "선택관광 문의드려요" }, { userId: u.id });
    expect(q.email).toBe("m@nubi.test");
    await expect(createInquiry({ category: "etc", title: "문의", body: "내용입니다" }, {})).rejects.toMatchObject({ status: 400 });
    const g = await createInquiry({ category: "etc", title: "문의", body: "내용입니다", name: "손님", email: "g@x.com" }, {});
    expect(g.user_id).toBeNull();
  });

  it("남의 예약번호는 이을 수 없다", async () => {
    const u = await member();
    const { departure } = await makeDeparture();
    const guestBooking = await createBooking(bookingInput(departure.id, 1));
    await expect(
      createInquiry({ category: "booking", title: "문의", body: "내용입니다", booking_code: guestBooking.code }, { userId: u.id }),
    ).rejects.toMatchObject({ code: "BAD_BOOKING" });
    const ok = await createInquiry(
      { category: "booking", title: "문의", body: "내용입니다", booking_code: guestBooking.code, name: "손님", email: "g@x.com" },
      { guestCode: guestBooking.code },
    );
    expect(ok.booking_id).toBe(guestBooking.id);
  });
});
