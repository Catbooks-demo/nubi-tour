/** 메모리 시도 제한 (앱 하나 기준). 창 안에서 limit번까지 허용. */
const hits = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowSec: number, now = Date.now()): boolean {
  const from = now - windowSec * 1000;
  const list = (hits.get(key) ?? []).filter((t) => t > from);
  if (list.length >= limit) {
    hits.set(key, list);
    return false;
  }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 10_000) {
    for (const [k, v] of hits) if (!v.some((t) => t > from)) hits.delete(k);
  }
  return true;
}

export function resetRateLimits(): void {
  hits.clear();
}

/** 로그인·가입·비회원 조회 공통: 10분에 10번. */
export const AUTH_LIMIT = { limit: 10, windowSec: 600 } as const;
