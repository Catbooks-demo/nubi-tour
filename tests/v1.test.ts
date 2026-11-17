import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as getOne } from "@/app/api/v1/bookings/[code]/route";
import { GET as listBookings } from "@/app/api/v1/bookings/route";
import { POST as setStatus } from "@/app/api/v1/departures/[id]/status/route";
import { POST as answer } from "@/app/api/v1/inquiries/[id]/answer/route";
import { GET as listInquiries } from "@/app/api/v1/inquiries/route";
import { issueApiKey, revokeApiKey } from "@/server/apikeys";
import { resetRateLimits } from "@/server/auth/ratelimit";
import { createBooking } from "@/server/bookings";
import { db } from "@/server/db";
import { OPENAPI } from "@/server/v1/openapi";
import { maskEmail, maskEn, maskKo, maskPhone } from "@/server/v1/serialize";
import { resetDb } from "./helpers/db";
import { bookingInput, makeDeparture } from "./helpers/fixtures";
import { call } from "./helpers/http";

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
});

const auth = (key: string) => ({ authorization: `Bearer ${key}` });

async function someBookings(n: number) {
  const { departure } = await makeDeparture({ capacity: 40 });
  const list = [];
  for (let i = 0; i < n; i++) list.push(await createBooking(bookingInput(departure.id, 1)));
  return { departure, list };
}

describe("키와 범위", () => {
  it("키 없음·틀림·폐기 401, 읽기 키로 쓰기 403", async () => {
    const { departure } = await someBookings(1);
    expect((await call(listBookings)).status).toBe(401);
    expect((await call(listBookings, { headers: auth("nbk_wrong") })).status).toBe(401);
    const read = await issueApiKey("정산", ["read"]);
    expect((await call(listBookings, { headers: auth(read.key) })).status).toBe(200);
    const w = await call(setStatus, { headers: auth(read.key), params: { id: departure.id }, body: { status: "closed" } });
    expect(w.status).toBe(403);
    await revokeApiKey(read.id);
    expect((await call(listBookings, { headers: auth(read.key) })).status).toBe(401);
  });

  it("키 원문은 저장하지 않는다", async () => {
    const k = await issueApiKey("x", ["read"]);
    const row = await db.apiKey.findFirstOrThrow();
    expect(JSON.stringify(row)).not.toContain(k.key);
    expect(k.key.startsWith(row.prefix)).toBe(true);
  });
});

describe("개인정보", () => {
  it("read는 가리고, read_pii는 원문, 여권은 어디에도 없다", async () => {
    await someBookings(1);
    await db.traveler.updateMany({ data: { passport_last4: "1234" } });
    const read = await issueApiKey("정산", ["read"]);
    const pii = await issueApiKey("ERP", ["read_pii"]);
    const masked = await call(listBookings, { headers: auth(read.key) });
    const raw = JSON.stringify(masked.body);
    expect(raw).not.toContain("김민지");
    expect(raw).not.toContain("01012345678");
    expect(raw).not.toContain("minji@example.com");
    expect(raw).not.toContain("1980-03-15");
    expect(raw).toContain("김*지");
    expect(raw).toContain("010-****-5678");
    const full = JSON.stringify((await call(listBookings, { headers: auth(pii.key) })).body);
    expect(full).toContain("김민지");
    expect(full).toContain("1980-03-15");
    for (const s of [raw, full]) {
      expect(s.toLowerCase()).not.toContain("passport");
      expect(s).not.toContain("guest_pin");
    }
  });

  it("가리기 모양", () => {
    expect(maskKo("김민지")).toBe("김*지");
    expect(maskEn("KIM MINJI")).toBe("K** M****");
    expect(maskPhone("01012345678")).toBe("010-****-5678");
    expect(maskEmail("minji@example.com")).toBe("m***@example.com");
  });
});

describe("페이지 나누기", () => {
  it("커서로 끝까지 읽으면 빠짐·겹침이 없다", async () => {
    const { list } = await someBookings(7);
    const k = await issueApiKey("x", ["read"]);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `http://localhost/api/v1/bookings?limit=3${cursor ? `&cursor=${cursor}` : ""}`;
      const r = await call<{ data: { code: string }[]; next_cursor: string | null }>(listBookings, { headers: auth(k.key), url });
      seen.push(...r.body.data.map((b) => b.code));
      cursor = r.body.next_cursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen.sort()).toEqual(list.map((b) => b.code).sort());
  });

  it("updated_since 이후 바뀐 것만", async () => {
    const { list } = await someBookings(3);
    const k = await issueApiKey("x", ["read"]);
    const mark = new Date();
    await new Promise((r) => setTimeout(r, 20));
    await db.booking.update({ where: { id: list[1].id }, data: { staff_memo: "변경" } });
    const r = await call<{ data: { code: string }[] }>(listBookings, { headers: auth(k.key), url: `http://localhost/x?updated_since=${mark.toISOString()}` });
    expect(r.body.data.map((b) => b.code)).toEqual([list[1].code]);
    expect((await call(listBookings, { headers: auth(k.key), url: "http://localhost/x?limit=500" })).status).toBe(400);
  });
});

describe("쓰기", () => {
  it("문의 답변과 출발일 상태, 작업 기록", async () => {
    const { departure, list } = await someBookings(1);
    const w = await issueApiKey("상담봇", ["read", "write"]);
    const q = await db.inquiry.create({ data: { name: "김민지", email: "m@x.com", category: "etc", title: "문의", body: "내용", booking_id: list[0].id } });
    expect((await call(answer, { headers: auth(w.key), params: { id: q.id }, body: { answer: "안녕하세요, 답변드려요." } })).status).toBe(200);
    const after = await db.inquiry.findUniqueOrThrow({ where: { id: q.id } });
    expect(after.status).toBe("answered");
    expect(after.answered_by).toBe("api:상담봇");
    const listed = await call<{ data: { status: string }[] }>(listInquiries, { headers: auth(w.key) });
    expect(listed.body.data[0].status).toBe("answered");

    expect((await call(setStatus, { headers: auth(w.key), params: { id: departure.id }, body: { status: "cancelled" } })).status).toBe(400);
    expect((await call(setStatus, { headers: auth(w.key), params: { id: departure.id }, body: { status: "confirmed" } })).status).toBe(200);
    expect(await db.auditLog.count({ where: { actor: "api:상담봇" } })).toBe(2);

    expect((await call(getOne, { headers: auth(w.key), params: { code: list[0].code } })).status).toBe(200);
  });
});

describe("OpenAPI", () => {
  it("모든 v1 경로를 설명한다", () => {
    const root = join(process.cwd(), "src", "app", "api", "v1");
    const routes = (readdirSync(root, { recursive: true }) as string[])
      .filter((f) => f.endsWith(`route.ts`) && !f.startsWith("openapi.json"))
      .map((f) => `/api/v1/${relative(".", f).split(sep).slice(0, -1).join("/")}`.replace(/\[(\w+)\]/g, "{$1}"));
    expect(routes.length).toBeGreaterThan(5);
    for (const r of routes) expect(Object.keys(OPENAPI.paths), r).toContain(r);
  });
});
