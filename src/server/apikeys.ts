import { randomBytes } from "node:crypto";
import type { ApiKey } from "@prisma/client";
import { rateLimit } from "./auth/ratelimit";
import { sha256 } from "./auth/session";
import { db } from "./db";
import { HttpError } from "./http";

export type Scope = "read" | "read_pii" | "write";
export const SCOPES: Scope[] = ["read", "read_pii", "write"];
export const SCOPE_KO: Record<Scope, string> = {
  read: "읽기 (개인정보 가림)",
  read_pii: "읽기 (개인정보 원문)",
  write: "쓰기 (문의 답변·예약 메모·출발일 상태)",
};

/** 키 발급. 원문은 이때 한 번만 돌려주고 DB엔 해시만 남긴다. */
export async function issueApiKey(name: string, scopes: Scope[], createdBy?: string): Promise<{ key: string; prefix: string; id: string }> {
  const clean = [...new Set(scopes)].filter((s) => SCOPES.includes(s));
  if (!clean.length) throw new HttpError(400, "BAD_SCOPES", "권한을 하나 이상 골라 주세요.");
  const key = `nbk_${randomBytes(32).toString("base64url")}`;
  const row = await db.apiKey.create({
    data: { name: name.trim().slice(0, 50) || "이름 없음", prefix: key.slice(0, 12), key_hash: sha256(key), scopes: clean, created_by: createdBy },
  });
  return { key, prefix: row.prefix, id: row.id };
}

export async function revokeApiKey(id: string): Promise<void> {
  await db.apiKey.update({ where: { id }, data: { revoked_at: new Date() } });
}

/** `Authorization: Bearer <키>` 확인. 키가 없거나 틀리거나 폐기됐으면 401, 범위가 모자라면 403, 분당 600회 넘으면 429. */
export async function authApiKey(req: Request, need: "read" | "write"): Promise<ApiKey> {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(\S+)$/i);
  if (!m) throw new HttpError(401, "UNAUTHORIZED", "API 키가 필요해요 (Authorization: Bearer <키>).");
  const key = await db.apiKey.findUnique({ where: { key_hash: sha256(m[1]) } });
  if (!key || key.revoked_at) throw new HttpError(401, "UNAUTHORIZED", "API 키가 맞지 않거나 폐기됐어요.");
  const ok = need === "write" ? key.scopes.includes("write") : key.scopes.includes("read") || key.scopes.includes("read_pii");
  if (!ok) throw new HttpError(403, "FORBIDDEN", `이 키에는 ${need === "write" ? "쓰기" : "읽기"} 권한이 없어요.`);
  if (!rateLimit(`api:${key.id}`, 600, 60)) throw new HttpError(429, "RATE_LIMITED", "요청이 너무 많아요. 1분 뒤 다시 시도해 주세요.");
  if (!key.last_used_at || Date.now() - key.last_used_at.getTime() > 60_000) {
    await db.apiKey.update({ where: { id: key.id }, data: { last_used_at: new Date() } });
  }
  return key;
}

export const canSeePii = (k: ApiKey) => k.scopes.includes("read_pii");
