import { beforeAll, describe, expect, it } from "vitest";
import { runSeed } from "../prisma/seed-lib";
import { addDays, kstDate } from "@/rules/time";
import { getTour, homeData, isBookable, maskName, searchTours } from "@/server/catalog";
import { db } from "@/server/db";
import { resetDb } from "./helpers/db";

const today = kstDate(new Date());

beforeAll(async () => {
  await resetDb();
  await runSeed(db, { today });
});

async function all(q: Parameters<typeof searchTours>[0]) {
  const first = await searchTours({ ...q, page: 1 });
  const items = [...first.items];
  for (let p = 2; p <= first.pages; p++) items.push(...(await searchTours({ ...q, page: p })).items);
  return { items, total: first.total };
}

describe("상품 검색", () => {
  it("지역으로 거른다", async () => {
    const r = await all({ region: "japan" });
    expect(r.total).toBeGreaterThan(0);
    expect(r.items.every((t) => t.region.code === "japan")).toBe(true);
  });

  it("출발 확정만: 확정 출발일이 있는 상품만", async () => {
    expect((await searchTours({ confirmedOnly: true })).total).toBe(0);
    const p = await db.product.findFirstOrThrow({ where: { code: "NB-JP-OSA-04" } });
    const d = await db.departure.findFirstOrThrow({ where: { product_id: p.id, depart_date: { gt: addDays(today, 10) } }, orderBy: { depart_date: "asc" } });
    await db.departure.update({ where: { id: d.id }, data: { status: "confirmed" } });
    const r = await all({ confirmedOnly: true });
    expect(r.items.map((t) => t.code)).toEqual(["NB-JP-OSA-04"]);
    expect(r.items[0].next_departure).toBe(d.depart_date);
  });

  it("달로 거르면 그 달 출발일이 있는 상품만, 최저가도 그 달 기준", async () => {
    const month = addDays(today, 40).slice(0, 7);
    const r = await all({ month });
    expect(r.total).toBeGreaterThan(0);
    for (const t of r.items) expect(t.next_departure?.startsWith(month)).toBe(true);
  });

  it("가격 낮은 순", async () => {
    const r = await all({ sort: "price" });
    const prices = r.items.map((t) => t.min_price ?? Infinity);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });

  it("검색어", async () => {
    const r = await all({ q: "융프라우" });
    expect(r.items.map((t) => t.code).sort()).toEqual(["NB-EU-SWI-08", "NB-EU-WE3-10"]);
    const r2 = await all({ q: "오사카 교토" });
    expect(r2.items.map((t) => t.code)).toEqual(["NB-JP-OSA-04"]);
    expect((await all({ q: "없는도시" })).total).toBe(0);
  });

  it("판매 중지 상품은 안 나온다", async () => {
    await db.product.update({ where: { code: "NB-CN-QDO-03" }, data: { on_sale: false } });
    expect((await all({})).items.map((t) => t.code)).not.toContain("NB-CN-QDO-03");
    expect(await getTour("NB-CN-QDO-03")).toBeNull();
  });
});

describe("상품 상세", () => {
  it("일정과 출발일(남은 좌석·예약 가능 여부)", async () => {
    const t = await getTour("NB-EU-ITA-09");
    expect(t?.product.itinerary).toHaveLength(9);
    expect(t?.departures.length).toBeGreaterThan(5);
    expect(t?.departures.every((d) => d.seats_left === 30)).toBe(true);
  });

  it("2일 이내 출발일은 예약 불가", () => {
    const base = { status: "open", capacity: 10, seats_taken: 0 };
    expect(isBookable({ ...base, depart_date: addDays(today, 2) })).toBe(false);
    expect(isBookable({ ...base, depart_date: addDays(today, 3) })).toBe(true);
    expect(isBookable({ ...base, depart_date: addDays(today, 30), seats_taken: 10 })).toBe(false);
  });

  it("이름 가리기", () => {
    expect(maskName("김민지")).toBe("김*지");
    expect(maskName("이준")).toBe("이*");
  });
});

describe("메인", () => {
  it("지역·테마·공지", async () => {
    const h = await homeData();
    expect(h.regions).toHaveLength(6);
    expect(h.themes.every((t) => t.items.length > 0)).toBe(true);
    expect(h.notices[0].pinned).toBe(true);
  });
});
