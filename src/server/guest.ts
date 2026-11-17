import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "./env";
import { readCookie } from "./http";

/** 비회원이 조회한 예약을 잠시 열어 두는 쿠키 (예약번호 + 서명). */
export const GUEST_COOKIE = "nb_guest";
export const GUEST_HOURS = 2;

function sign(code: string): string {
  const secret = getEnv().SESSION_SECRET || "dev-only-secret";
  return createHmac("sha256", secret).update(`guest:${code}`).digest("base64url");
}

export function guestToken(code: string): string {
  return `${code}.${sign(code)}`;
}

/** 쿠키가 연 예약번호 (서명이 맞을 때만). */
export function guestCodeFromRequest(req: Request): string | null {
  const raw = readCookie(req, GUEST_COOKIE);
  if (!raw) return null;
  const i = raw.lastIndexOf(".");
  if (i < 0) return null;
  const code = raw.slice(0, i);
  const a = Buffer.from(raw.slice(i + 1));
  const b = Buffer.from(sign(code));
  return a.length === b.length && timingSafeEqual(a, b) ? code : null;
}
