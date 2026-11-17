import { NextResponse } from "next/server";
import { AUTH_LIMIT, rateLimit } from "@/server/auth/ratelimit";
import { USER_COOKIE, USER_SESSION_DAYS, cookieOptions, issueUserSession } from "@/server/auth/session";
import { login, loginSchema, publicUser } from "@/server/auth/users";
import { HttpError, clientIp, readJson, route } from "@/server/http";

export const POST = route(async (req) => {
  const { email, password } = await readJson(req, loginSchema);
  if (!rateLimit(`login:${clientIp(req)}:${email}`, AUTH_LIMIT.limit, AUTH_LIMIT.windowSec)) {
    throw new HttpError(429, "TOO_MANY", "로그인 시도가 너무 많아요. 10분 뒤 다시 시도해 주세요.");
  }
  const user = await login(email, password);
  const token = await issueUserSession(user.id);
  const res = NextResponse.json({ user: publicUser(user) });
  res.cookies.set(USER_COOKIE, token, cookieOptions(USER_SESSION_DAYS * 86_400));
  return res;
});
