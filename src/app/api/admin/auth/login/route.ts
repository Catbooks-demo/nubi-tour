import { NextResponse } from "next/server";
import { AUTH_LIMIT, rateLimit } from "@/server/auth/ratelimit";
import { STAFF_COOKIE, STAFF_SESSION_HOURS, cookieOptions, issueStaffSession } from "@/server/auth/session";
import { loginSchema, publicStaff, staffLogin } from "@/server/auth/users";
import { HttpError, clientIp, readJson, route } from "@/server/http";

export const POST = route(async (req) => {
  const { email, password } = await readJson(req, loginSchema);
  if (!rateLimit(`staff-login:${clientIp(req)}:${email}`, AUTH_LIMIT.limit, AUTH_LIMIT.windowSec)) {
    throw new HttpError(429, "TOO_MANY", "로그인 시도가 너무 많아요. 10분 뒤 다시 시도해 주세요.");
  }
  const staff = await staffLogin(email, password);
  const token = await issueStaffSession(staff.id);
  const res = NextResponse.json({ staff: publicStaff(staff) });
  res.cookies.set(STAFF_COOKIE, token, cookieOptions(STAFF_SESSION_HOURS * 3600));
  return res;
});
