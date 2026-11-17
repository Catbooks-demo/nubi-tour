import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().default(""),
  APP_BASE_URL: z.string().default("http://localhost:3000"),
  TOSS_CLIENT_KEY: z.string().optional(),
  TOSS_SECRET_KEY: z.string().optional(),
  SEED_STAFF_EMAIL: z.string().optional(),
  SEED_STAFF_PASSWORD: z.string().optional(),
  JOBS_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v ?? "true").toLowerCase() !== "false"),
});

export type Env = z.infer<typeof schema>;

/** 토스 키 검사: 실제 돈이 오가는 live_ 키는 받지 않는다. */
export function assertSafeTossKeys(e: { TOSS_CLIENT_KEY?: string; TOSS_SECRET_KEY?: string }): void {
  for (const k of [e.TOSS_CLIENT_KEY, e.TOSS_SECRET_KEY]) {
    if (k && k.trim().startsWith("live_")) {
      throw new Error("토스 라이브 키는 쓸 수 없어요. 테스트 키(test_)만 넣어 주세요.");
    }
  }
}

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.parse(process.env);
  const clean = (v?: string) => (v && v.trim() ? v.trim() : undefined);
  parsed.TOSS_CLIENT_KEY = clean(parsed.TOSS_CLIENT_KEY);
  parsed.TOSS_SECRET_KEY = clean(parsed.TOSS_SECRET_KEY);
  assertSafeTossKeys(parsed);
  cached = parsed;
  return parsed;
}

/** 토스 테스트 결제가 켜져 있는지 (두 키가 모두 있을 때만). */
export function tossEnabled(): boolean {
  const e = getEnv();
  return Boolean(e.TOSS_CLIENT_KEY && e.TOSS_SECRET_KEY);
}
