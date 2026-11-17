import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "./env";
import { readCookie } from "./http";

/** 비회원이 조회한 예약을 잠시 열어 두는 쿠키: 예약번호.발급시각.서명 (2시간). */
export const GUEST_COOKIE = "nb_guest";
export const GUEST_HOURS = 2;

function secret(): string {
  const s = getEnv().SESSION_SECRET;
  if (s) return s;
  // 운영에서는 getEnv가 짧은 비밀값을 거부하므로 여기까지 오지 않는다
  return "dev-only-secret";
}

function sign(code: string, issued: string): string {
  return createHmac("sha256", secret()).update(`guest:${code}:${issued}`).digest("base64url");
}

export function guestToken(code: string, now: Date = new Date()): string {
  const issued = Math.floor(now.getTime() / 1000).toString(36);
  return `${code}.${issued}.${sign(code, issued)}`;
}

/** 쿠키가 연 예약번호 (서명이 맞고 2시간 안일 때만). */
export function guestCodeFromRequest(req: Request, now: Date = new Date()): string | null {
  const raw = readCookie(req, GUEST_COOKIE);
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [code, issued, sig] = parts;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(code, issued));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const at = parseInt(issued, 36) * 1000;
  if (!Number.isFinite(at) || now.getTime() - at > GUEST_HOURS * 3_600_000 || at - now.getTime() > 60_000) return null;
  return code;
}
