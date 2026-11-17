import { createHash, randomBytes } from "node:crypto";
import type { Staff, User } from "@prisma/client";
import { db } from "../db";
import { getEnv } from "../env";
import { HttpError, readCookie } from "../http";

export const USER_COOKIE = "nb_session";
export const STAFF_COOKIE = "nb_staff";
export const USER_SESSION_DAYS = 30;
export const STAFF_SESSION_HOURS = 12;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

export function cookieOptions(maxAgeSec: number) {
  const secure = getEnv().APP_BASE_URL.startsWith("https://");
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: maxAgeSec };
}

// ── 회원 ──
export async function issueUserSession(userId: string): Promise<string> {
  const token = newToken();
  await db.session.create({
    data: {
      token_hash: sha256(token),
      user_id: userId,
      expires_at: new Date(Date.now() + USER_SESSION_DAYS * 86_400_000),
    },
  });
  return token;
}

export async function userFromToken(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const s = await db.session.findUnique({ where: { token_hash: sha256(token) }, include: { user: true } });
  if (!s || s.expires_at < new Date()) return null;
  return s.user;
}

export async function revokeUserSession(token: string | undefined): Promise<void> {
  if (token) await db.session.deleteMany({ where: { token_hash: sha256(token) } });
}

export function userFromRequest(req: Request): Promise<User | null> {
  return userFromToken(readCookie(req, USER_COOKIE));
}

export async function requireUser(req: Request): Promise<User> {
  const u = await userFromRequest(req);
  if (!u) throw new HttpError(401, "LOGIN_REQUIRED", "로그인이 필요해요.");
  return u;
}

// ── 직원 ──
export async function issueStaffSession(staffId: string): Promise<string> {
  const token = newToken();
  await db.staffSession.create({
    data: {
      token_hash: sha256(token),
      staff_id: staffId,
      expires_at: new Date(Date.now() + STAFF_SESSION_HOURS * 3_600_000),
    },
  });
  return token;
}

export async function staffFromToken(token: string | undefined): Promise<Staff | null> {
  if (!token) return null;
  const s = await db.staffSession.findUnique({ where: { token_hash: sha256(token) }, include: { staff: true } });
  if (!s || s.expires_at < new Date() || !s.staff.active) return null;
  return s.staff;
}

export async function revokeStaffSession(token: string | undefined): Promise<void> {
  if (token) await db.staffSession.deleteMany({ where: { token_hash: sha256(token) } });
}

/** 직원 확인. 없으면 401, role이 admin인데 아니면 403. */
export async function requireStaff(req: Request, role?: "admin"): Promise<Staff> {
  const s = await staffFromToken(readCookie(req, STAFF_COOKIE));
  if (!s) throw new HttpError(401, "STAFF_LOGIN_REQUIRED", "직원 로그인이 필요해요.");
  if (role === "admin" && s.role !== "admin") throw new HttpError(403, "ADMIN_ONLY", "관리자만 할 수 있어요.");
  return s;
}
