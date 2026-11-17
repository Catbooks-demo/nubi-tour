import { NextResponse } from "next/server";
import { z } from "zod";
import { AUTH_LIMIT, rateLimit } from "@/server/auth/ratelimit";
import { cookieOptions } from "@/server/auth/session";
import { bookingView, findBookingForGuest, getBookingFull } from "@/server/bookings";
import { GUEST_COOKIE, GUEST_HOURS, guestToken } from "@/server/guest";
import { HttpError, clientIp, readJson, route } from "@/server/http";

const body = z.object({
  code: z.string().trim().min(1, "예약번호를 넣어 주세요."),
  phone: z.string().min(1, "휴대폰 번호를 넣어 주세요."),
  pin: z.string().min(1, "조회 비밀번호를 넣어 주세요."),
});

/** 비회원 예약 조회: 예약번호 + 휴대폰 + 조회 비밀번호. 맞으면 2시간짜리 조회 쿠키. */
export const POST = route(async (req) => {
  const { code, phone, pin } = await readJson(req, body);
  // IP마다, 그리고 예약번호마다 따로 막는다 (IP를 바꿔 가며 조회 비밀번호를 맞히지 못하게)
  const okIp = rateLimit(`lookup:${clientIp(req)}`, AUTH_LIMIT.limit, AUTH_LIMIT.windowSec);
  const okCode = rateLimit(`lookup-code:${code.trim().toUpperCase()}`, AUTH_LIMIT.limit, AUTH_LIMIT.windowSec);
  if (!okIp || !okCode) {
    throw new HttpError(429, "TOO_MANY", "조회 시도가 너무 많아요. 10분 뒤 다시 시도해 주세요.");
  }
  const b = await findBookingForGuest(code, phone, pin);
  if (!b) throw new HttpError(404, "NOT_FOUND", "입력한 정보와 맞는 예약이 없어요.");
  const res = NextResponse.json({ booking: bookingView((await getBookingFull(b.code))!) });
  res.cookies.set(GUEST_COOKIE, guestToken(b.code), cookieOptions(GUEST_HOURS * 3600));
  return res;
});
