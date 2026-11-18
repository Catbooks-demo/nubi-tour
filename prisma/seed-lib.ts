import type { PrismaClient } from "@prisma/client";
import { addDays, kstDate, weekday } from "../src/rules/time";
import { hashPassword } from "../src/server/auth/password";
import { BASE_EXCLUDES, BASE_INCLUDES, PRODUCTS, REGIONS, THEMES, type SeedProduct } from "./seed-data/products";
import { FAQS, NOTICES } from "./seed-data/notices";

/** 같은 입력이면 같은 값 (0 이상 1 미만). 시드를 다시 돌려도 가격이 같게. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** 패키지 가격처럼 끝을 9,000원으로 (예: 899,000). */
function packagePrice(raw: number): number {
  return Math.max(10000, Math.round(raw / 10000) * 10000 - 1000);
}

const round1000 = (n: number) => Math.round(n / 1000) * 1000;

function isPeak(date: string): boolean {
  const md = date.slice(5);
  return (md >= "12-20" || md <= "01-05") || (md >= "07-20" && md <= "08-15");
}

/** 상품별로 정해진 출발 요일 두 개. */
function departureWeekdays(p: SeedProduct): number[] {
  const first = Math.floor(hash01(p.code) * 7);
  const gap = p.days <= 5 ? 3 : 4;
  return [first, (first + gap) % 7];
}

export interface DepartureSeed {
  depart_date: string;
  return_date: string;
  capacity: number;
  min_pax: number;
  price_adult: number;
  price_child: number;
  price_infant: number;
  single_supplement: number;
}

/**
 * 오늘(KST) 3일 뒤부터 90일 안의 출발일. `range`로 범위(오늘 기준 일 수, 양 끝 포함)를 바꿀 수 있다:
 * 가상 데이터는 지난 출발일(`from` 음수)도 같은 규칙으로 만든다. 날짜·가격은 상품 코드와 날짜로만 정해져
 * 기준일이 달라도 같은 날의 출발일은 같다.
 */
export function planDepartures(
  p: SeedProduct,
  today: string,
  range: { from?: number; to?: number } = {},
): DepartureSeed[] {
  const days = departureWeekdays(p);
  const out: DepartureSeed[] = [];
  const from = range.from ?? 3;
  const to = range.to ?? 90;
  for (let i = from; i <= to; i++) {
    const date = addDays(today, i);
    if (!days.includes(weekday(date))) continue;
    const wd = weekday(date);
    let factor = 1 + hash01(p.code + date) * 0.04;
    if (wd === 5 || wd === 6) factor += 0.05;
    if (isPeak(date)) factor += 0.15;
    const adult = packagePrice(p.price * factor);
    out.push({
      depart_date: date,
      return_date: addDays(date, p.days - 1),
      capacity: p.capacity ?? (p.days <= 5 ? 24 : 30),
      min_pax: p.minPax ?? (p.days <= 5 ? 6 : 15),
      price_adult: adult,
      price_child: round1000(adult * 0.9),
      price_infant: round1000(adult * 0.1),
      single_supplement: p.single ?? 0,
    });
  }
  return out;
}

export interface SeedResult {
  products: number;
  departures: number;
  staff: boolean;
}

/** 시드: 여러 번 돌려도 결과가 같다(코드·날짜로 찾아 고친다). 이미 있는 출발일의 좌석·상태는 건드리지 않는다. */
export async function runSeed(
  db: PrismaClient,
  opts: { today?: string; staffEmail?: string; staffPassword?: string } = {},
): Promise<SeedResult> {
  const today = opts.today ?? kstDate(new Date());

  const regionIds = new Map<string, string>();
  for (const r of REGIONS) {
    const row = await db.region.upsert({
      where: { code: r.code },
      create: { code: r.code, name: r.name, sort_order: r.sort },
      update: { name: r.name, sort_order: r.sort },
    });
    regionIds.set(r.code, row.id);
  }
  const themeIds = new Map<string, string>();
  for (const t of THEMES) {
    const row = await db.theme.upsert({ where: { code: t.code }, create: { ...t }, update: { name: t.name } });
    themeIds.set(t.code, row.id);
  }

  let departures = 0;
  for (const [i, p] of PRODUCTS.entries()) {
    const regionId = regionIds.get(p.region);
    if (!regionId) throw new Error(`지역 없음: ${p.region}`);
    const data = {
      name: p.name,
      region_id: regionId,
      country: p.country,
      cities: p.cities,
      nights: p.nights,
      days: p.days,
      airline: p.airline,
      departure_airport: p.airport ?? "인천",
      summary: p.summary,
      highlights: p.highlights,
      includes: p.includes ?? BASE_INCLUDES,
      excludes: p.excludes ?? BASE_EXCLUDES,
      optional_tours: p.optional ?? [],
      shopping_count: p.shopping,
      guide: p.guide,
      travel_docs: travelDocs(p.country),
      base_price: p.price,
      sort_rank: i + 1,
    };
    const product = await db.product.upsert({ where: { code: p.code }, create: { code: p.code, ...data }, update: data });

    await db.productTheme.deleteMany({ where: { product_id: product.id } });
    await db.productTheme.createMany({
      data: p.themes.map((code) => {
        const id = themeIds.get(code);
        if (!id) throw new Error(`테마 없음: ${code}`);
        return { product_id: product.id, theme_id: id };
      }),
    });

    await db.itineraryDay.deleteMany({ where: { product_id: product.id } });
    await db.itineraryDay.createMany({
      data: p.itinerary.map(([city, title, details, meals, hotel], idx) => {
        const [breakfast, lunch, dinner] = meals.split("/");
        return {
          product_id: product.id,
          day: idx + 1,
          city,
          title,
          details: details.split("|"),
          breakfast,
          lunch,
          dinner,
          hotel,
        };
      }),
    });

    for (const d of planDepartures(p, today)) {
      await db.departure.upsert({
        where: { product_id_depart_date: { product_id: product.id, depart_date: d.depart_date } },
        create: { product_id: product.id, ...d },
        update: {},
      });
      departures++;
    }
  }

  for (const n of [...NOTICES, ...FAQS]) {
    const found = await db.notice.findFirst({ where: { kind: n.kind, title: n.title } });
    if (found) await db.notice.update({ where: { id: found.id }, data: n });
    else await db.notice.create({ data: n });
  }

  let staff = false;
  if (opts.staffEmail && opts.staffPassword) {
    const email = opts.staffEmail.trim().toLowerCase();
    const exists = await db.staff.findUnique({ where: { email } });
    if (!exists) {
      await db.staff.create({
        data: { email, name: "관리자", role: "admin", password_hash: await hashPassword(opts.staffPassword) },
      });
    }
    staff = true;
  }

  return { products: PRODUCTS.length, departures, staff };
}

function travelDocs(country: string): string {
  const base = "여권 유효기간이 귀국일 기준 6개월 이상 남아 있어야 해요.";
  if (country.includes("미국")) return `${base} 미국 전자여행허가(ESTA)가 필요해요.`;
  if (country.includes("캐나다")) return `${base} 캐나다 전자여행허가(eTA)가 필요해요.`;
  if (country.includes("호주")) return `${base} 호주 전자비자(ETA)가 필요해요.`;
  if (country.includes("뉴질랜드")) return `${base} 뉴질랜드 전자여행허가(NZeTA)가 필요해요.`;
  if (country === "중국") return `${base} 중국 입국 조건은 출발 전 다시 안내해 드려요.`;
  return `${base} 한국 여권은 비자 없이 입국할 수 있어요(관광 목적, 체류 기간 확인).`;
}
