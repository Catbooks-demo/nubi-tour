import { NextResponse } from "next/server";
import { AUTH_LIMIT, rateLimit } from "@/server/auth/ratelimit";
import { USER_COOKIE, USER_SESSION_DAYS, cookieOptions, issueUserSession } from "@/server/auth/session";
import { publicUser, signup, signupSchema } from "@/server/auth/users";
import { HttpError, clientIp, readJson, route } from "@/server/http";

export const POST = route(async (req) => {
  if (!rateLimit(`signup:${clientIp(req)}`, AUTH_LIMIT.limit, AUTH_LIMIT.windowSec)) {
    throw new HttpError(429, "TOO_MANY", "잠시 후 다시 시도해 주세요.");
  }
  const input = await readJson(req, signupSchema);
  const user = await signup(input);
  const token = await issueUserSession(user.id);
  const res = NextResponse.json({ user: publicUser(user) }, { status: 201 });
  res.cookies.set(USER_COOKIE, token, cookieOptions(USER_SESSION_DAYS * 86_400));
  return res;
});
