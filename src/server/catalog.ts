import { addDays, daysBefore, kstDate } from "@/rules/time";
import { db } from "./db";

/** 온라인 예약을 받을 수 있는 출발일인지 (2일 이내·마감·취소 제외). */
export function isBookable(d: { depart_date: string; status: string; capacity: number; seats_taken: number }, now = new Date()): boolean {
  return (
    (d.status === "open" || d.status === "confirmed") &&
    d.capacity - d.seats_taken > 0 &&
    daysBefore(d.depart_date, now) > 2
  );
}

export interface TourSummary {
  code: string;
  name: string;
  region: { code: string; name: string };
  country: string;
  cities: string[];
  nights: number;
  days: number;
  airline: string;
  shopping_count: number;
  themes: { code: string; name: string }[];
  highlights: string[];
  min_price: number | null;
  next_departure: string | null;
  bookable_count: number;
  has_confirmed: boolean;
}

export interface TourQuery {
  region?: string;
  theme?: string;
  month?: string; // YYYY-MM
  nights?: number;
  priceMax?: number;
  airline?: string;
  confirmedOnly?: boolean;
  q?: string;
  sort?: "recommended" | "price" | "departure";
  page?: number;
}

export const PAGE_SIZE = 12;

async function loadSummaries(now: Date) {
  const today = kstDate(now);
  const products = await db.product.findMany({
    where: { on_sale: true },
    include: {
      region: true,
      themes: { include: { theme: true } },
      departures: { where: { depart_date: { gt: addDays(today, 2) } }, orderBy: { depart_date: "asc" } },
    },
    orderBy: { sort_rank: "asc" },
  });
  return products.map((p) => {
    const open = p.departures.filter((d) => isBookable(d, now));
    return {
      product: p,
      open,
      summary: {
        code: p.code,
        name: p.name,
        region: { code: p.region.code, name: p.region.name },
        country: p.country,
        cities: p.cities,
        nights: p.nights,
        days: p.days,
        airline: p.airline,
        shopping_count: p.shopping_count,
        themes: p.themes.map((t) => ({ code: t.theme.code, name: t.theme.name })),
        highlights: p.highlights,
        min_price: open.length ? Math.min(...open.map((d) => d.price_adult)) : null,
        next_departure: open[0]?.depart_date ?? null,
        bookable_count: open.length,
        has_confirmed: open.some((d) => d.status === "confirmed"),
      } satisfies TourSummary,
    };
  });
}

export async function searchTours(q: TourQuery, now = new Date()): Promise<{ items: TourSummary[]; total: number; page: number; pages: number }> {
  let rows = await loadSummaries(now);
  if (q.region) rows = rows.filter((r) => r.summary.region.code === q.region);
  if (q.theme) rows = rows.filter((r) => r.summary.themes.some((t) => t.code === q.theme));
  if (q.airline) rows = rows.filter((r) => r.summary.airline === q.airline);
  if (q.nights) rows = rows.filter((r) => (q.nights! >= 7 ? r.summary.nights >= 7 : r.summary.nights === q.nights));
  if (q.q) {
    const words = q.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    rows = rows.filter((r) => {
      const hay = [r.summary.name, r.summary.country, ...r.summary.cities, r.summary.region.name, ...r.summary.highlights, r.product.summary]
        .join(" ")
        .toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }
  // 출발일 조건(월·확정·가격)은 그 조건에 맞는 출발일로 다시 계산한다
  rows = rows
    .map((r) => {
      let ds = r.open;
      if (q.month) ds = ds.filter((d) => d.depart_date.startsWith(q.month!));
      if (q.confirmedOnly) ds = ds.filter((d) => d.status === "confirmed");
      if (q.priceMax) ds = ds.filter((d) => d.price_adult <= q.priceMax!);
      const filtered = q.month || q.confirmedOnly || q.priceMax;
      if (!filtered) return r;
      return {
        ...r,
        open: ds,
        summary: {
          ...r.summary,
          min_price: ds.length ? Math.min(...ds.map((d) => d.price_adult)) : null,
          next_departure: ds[0]?.depart_date ?? null,
          bookable_count: ds.length,
          has_confirmed: ds.some((d) => d.status === "confirmed"),
        },
      };
    })
    .filter((r) => !(q.month || q.confirmedOnly || q.priceMax) || r.open.length > 0);

  const items = rows.map((r) => r.summary);
  if (q.sort === "price") items.sort((a, b) => (a.min_price ?? Infinity) - (b.min_price ?? Infinity));
  if (q.sort === "departure") items.sort((a, b) => (a.next_departure ?? "9999").localeCompare(b.next_departure ?? "9999"));

  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, q.page ?? 1), pages);
  return { items: items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: items.length, page, pages };
}

export interface DepartureView {
  id: string;
  depart_date: string;
  return_date: string;
  price_adult: number;
  price_child: number;
  price_infant: number;
  single_supplement: number;
  deposit_per_person: number;
  status: string;
  seats_left: number;
  min_pax: number;
  bookable: boolean;
}

export async function getTour(code: string, now = new Date()) {
  const today = kstDate(now);
  const p = await db.product.findUnique({
    where: { code },
    include: {
      region: true,
      themes: { include: { theme: true } },
      itinerary: { orderBy: { day: "asc" } },
      departures: { where: { depart_date: { gte: today } }, orderBy: { depart_date: "asc" } },
    },
  });
  if (!p || !p.on_sale) return null;
  const reviews = await db.review.findMany({
    where: { product_id: p.id, hidden: false },
    include: { user: { select: { name: true } } },
    orderBy: { created_at: "desc" },
    take: 20,
  });
  const departures: DepartureView[] = p.departures.map((d) => ({
    id: d.id,
    depart_date: d.depart_date,
    return_date: d.return_date,
    price_adult: d.price_adult,
    price_child: d.price_child,
    price_infant: d.price_infant,
    single_supplement: d.single_supplement,
    deposit_per_person: d.deposit_per_person,
    status: d.status,
    seats_left: Math.max(0, d.capacity - d.seats_taken),
    min_pax: d.min_pax,
    bookable: isBookable(d, now),
  }));
  return {
    product: p,
    departures,
    reviews: reviews.map((r) => ({
      rating: r.rating,
      body: r.body,
      name: maskName(r.user.name),
      created_at: r.created_at.toISOString(),
    })),
    rating: reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : null,
  };
}

export type TourDetail = NonNullable<Awaited<ReturnType<typeof getTour>>>;

export function maskName(name: string): string {
  if (name.length <= 1) return name;
  if (name.length === 2) return `${name[0]}*`;
  return `${name[0]}${"*".repeat(name.length - 2)}${name.at(-1)}`;
}

/** 메인 화면에 필요한 것. */
export async function homeData(now = new Date()) {
  const rows = await loadSummaries(now);
  const all = rows.map((r) => r.summary);
  const confirmed = rows
    .flatMap((r) => r.open.filter((d) => d.status === "confirmed").map((d) => ({ tour: r.summary, departure: d })))
    .sort((a, b) => a.departure.depart_date.localeCompare(b.departure.depart_date))
    .slice(0, 6)
    .map(({ tour, departure }) => ({
      tour,
      departure: { id: departure.id, depart_date: departure.depart_date, price_adult: departure.price_adult, seats_left: departure.capacity - departure.seats_taken },
    }));
  const regions = await db.region.findMany({ orderBy: { sort_order: "asc" } });
  const notices = await db.notice.findMany({
    where: { kind: "notice", published: true },
    orderBy: [{ pinned: "desc" }, { created_at: "desc" }],
    take: 4,
  });
  const byTheme = (code: string) => all.filter((t) => t.themes.some((x) => x.code === code) && t.min_price).slice(0, 4);
  return {
    regions: regions.map((r) => ({ code: r.code, name: r.name, count: all.filter((t) => t.region.code === r.code).length })),
    confirmed,
    themes: [
      { code: "parents", title: "부모님과 함께, 걷는 양이 적은 여행", items: byTheme("parents") },
      { code: "honeymoon", title: "둘만의 허니문", items: byTheme("honeymoon") },
      { code: "family", title: "아이와 가기 좋은 여행", items: byTheme("family") },
    ],
    notices: notices.map((n) => ({ id: n.id, title: n.title, pinned: n.pinned })),
    airlines: [...new Set(all.map((t) => t.airline))].sort(),
  };
}
