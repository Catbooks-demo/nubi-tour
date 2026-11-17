import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as healthz } from "@/app/healthz/route";
import { GET as readyz } from "@/app/readyz/route";
import { db } from "@/server/db";
import { assertSafeTossKeys } from "@/server/env";
import { log } from "@/server/log";

afterEach(() => vi.restoreAllMocks());

describe("상태 확인", () => {
  it("healthz는 200 ok", async () => {
    const res = healthz();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("readyz는 DB가 되면 200 ready", async () => {
    const res = await readyz();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ready" });
  });

  it("readyz는 DB가 안 되면 503", async () => {
    vi.spyOn(db, "$queryRaw").mockRejectedValueOnce(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await readyz();
    expect(res.status).toBe(503);
  });
});

describe("설정", () => {
  it("토스 live 키를 거부한다", () => {
    expect(() => assertSafeTossKeys({ TOSS_SECRET_KEY: "live_sk_x" })).toThrow();
    expect(() => assertSafeTossKeys({ TOSS_SECRET_KEY: "test_sk_x", TOSS_CLIENT_KEY: "test_ck_x" })).not.toThrow();
  });

  it("로그는 비밀값을 가린다", () => {
    expect(log.scrub({ password: "p", nested: { token: "t", ok: 1 } })).toEqual({
      password: "[가림]",
      nested: { token: "[가림]", ok: 1 },
    });
  });
});
