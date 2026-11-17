import { NextResponse } from "next/server";
import { requireUser, userFromRequest } from "@/server/auth/session";
import { bookingInclude, bookingView, createBooking, createBookingSchema, getBookingFull } from "@/server/bookings";
import { db } from "@/server/db";
import { GUEST_COOKIE, GUEST_HOURS, guestToken } from "@/server/guest";
import { cookieOptions } from "@/server/auth/session";
import { readJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

/** 내 예약 목록 (회원). */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const list = await db.booking.findMany({
    where: { user_id: user.id },
    include: bookingInclude,
    orderBy: { created_at: "desc" },
  });
  return NextResponse.json({ bookings: list.map(bookingView) });
});

/** 예약 만들기 (회원 또는 비회원). */
export const POST = route(async (req) => {
  const input = await readJson(req, createBookingSchema);
  const user = await userFromRequest(req);
  const booking = await createBooking({ ...input, userId: user?.id ?? null });
  const full = await getBookingFull(booking.code);
  const res = NextResponse.json({ booking: bookingView(full!) }, { status: 201 });
  if (!user) res.cookies.set(GUEST_COOKIE, guestToken(booking.code), cookieOptions(GUEST_HOURS * 3600));
  return res;
});
