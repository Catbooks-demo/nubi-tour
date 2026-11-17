import { beforeAll, describe, expect, it } from "vitest";
import { runSeed } from "../prisma/seed-lib";
import { db } from "@/server/db";
import { addDays, kstDate } from "@/rules/time";
import { resetDb } from "./helpers/db";

const today = kstDate(new Date());

describe("시드", () => {
  beforeAll(async () => {
    await resetDb();
    await runSeed(db, { today, staffEmail: "admin@nubi.test", staffPassword: "seed-pass-123" });
  });

  it("상품 40개 이상, 6개 지역 모두 상품이 있다", async () => {
    expect(await db.product.count()).toBeGreaterThanOrEqual(40);
    const regions = await db.region.findMany({ include: { _count: { select: { products: true } } } });
    expect(regions.map((r) => r.code).sort()).toEqual(
      ["americas", "china", "europe", "japan", "oceania", "southeast-asia"],
    );
    for (const r of regions) expect(r._count.products).toBeGreaterThan(0);
  });

  it("모든 상품의 일정 일 수가 여행 일 수와 같다", async () => {
    const products = await db.product.findMany({ include: { _count: { select: { itinerary: true } } } });
    for (const p of products) expect(p._count.itinerary, p.code).toBe(p.days);
  });

  it("상품마다 앞으로 90일 안 출발일이 6개 이상", async () => {
    const products = await db.product.findMany({ include: { departures: true } });
    const last = addDays(today, 90);
    for (const p of products) {
      const inRange = p.departures.filter((d) => d.depart_date > today && d.depart_date <= last);
      expect(inRange.length, p.code).toBeGreaterThanOrEqual(6);
      for (const d of p.departures) {
        expect(d.price_child).toBeLessThan(d.price_adult);
        expect(d.price_infant).toBeLessThan(d.price_child);
      }
    }
  });

  it("두 번 돌려도 같다 (멱등)", async () => {
    const before = [await db.product.count(), await db.departure.count(), await db.itineraryDay.count(), await db.notice.count()];
    await runSeed(db, { today, staffEmail: "admin@nubi.test", staffPassword: "seed-pass-123" });
    const after = [await db.product.count(), await db.departure.count(), await db.itineraryDay.count(), await db.notice.count()];
    expect(after).toEqual(before);
    expect(await db.staff.count()).toBe(1);
  });

  it("직원 비밀번호는 원문으로 저장하지 않는다", async () => {
    const s = await db.staff.findFirstOrThrow();
    expect(s.password_hash).not.toContain("seed-pass-123");
    expect(s.password_hash.startsWith("scrypt$")).toBe(true);
  });
});
