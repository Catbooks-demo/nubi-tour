import type { Metadata } from "next";
import Link from "next/link";
import { TourCard } from "@/components/TourCard";
import { addDays, kstDate } from "@/rules/time";
import { type TourQuery, homeData, searchTours } from "@/server/catalog";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "패키지 상품" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

const NIGHTS = [
  { v: "2", label: "2박" },
  { v: "3", label: "3박" },
  { v: "4", label: "4박" },
  { v: "5", label: "5박" },
  { v: "6", label: "6박" },
  { v: "7", label: "7박 이상" },
];
const PRICES = [
  { v: "1000000", label: "100만 원 이하" },
  { v: "2000000", label: "200만 원 이하" },
  { v: "3000000", label: "300만 원 이하" },
  { v: "5000000", label: "500만 원 이하" },
];

export default async function ToursPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q: TourQuery = {
    region: one(sp.region),
    theme: one(sp.theme),
    month: one(sp.month),
    nights: one(sp.nights) ? Number(one(sp.nights)) : undefined,
    priceMax: one(sp.price) ? Number(one(sp.price)) : undefined,
    airline: one(sp.airline),
    confirmedOnly: one(sp.confirmed) === "1",
    q: one(sp.q),
    sort: (one(sp.sort) as TourQuery["sort"]) ?? "recommended",
    page: one(sp.page) ? Number(one(sp.page)) : 1,
  };
  const [result, home, themes] = await Promise.all([searchTours(q), homeData(), db.theme.findMany({ orderBy: { code: "asc" } })]);
  const today = kstDate(new Date());
  const months = Array.from(new Set(Array.from({ length: 4 }, (_, i) => addDays(today, i * 30 + 3).slice(0, 7))));
  const regionName = home.regions.find((r) => r.code === q.region)?.name;
  const title = q.q ? `‘${q.q}’ 검색 결과` : regionName ? `${regionName} 패키지` : q.confirmedOnly ? "출발 확정 상품" : "전체 패키지";

  const pageHref = (page: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (one(v) && k !== "page") p.set(k, one(v)!);
    p.set("page", String(page));
    return `/tours?${p}`;
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-bold">{title}</h1>

      <form className="mt-5 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-4 lg:grid-cols-8" aria-label="상품 조건">
        <input type="hidden" name="q" defaultValue={q.q ?? ""} />
        <Select name="region" label="지역" value={q.region} options={home.regions.map((r) => ({ v: r.code, label: r.name }))} />
        <Select name="month" label="출발 월" value={q.month} options={months.map((m) => ({ v: m, label: `${Number(m.slice(5))}월` }))} />
        <Select name="nights" label="일정" value={q.nights ? String(q.nights) : undefined} options={NIGHTS} />
        <Select name="price" label="1인 요금" value={q.priceMax ? String(q.priceMax) : undefined} options={PRICES} />
        <Select name="airline" label="항공사" value={q.airline} options={home.airlines.map((a) => ({ v: a, label: a }))} />
        <Select name="theme" label="테마" value={q.theme} options={themes.map((t) => ({ v: t.code, label: t.name }))} />
        <Select
          name="sort"
          label="정렬"
          value={q.sort}
          all={false}
          options={[
            { v: "recommended", label: "추천순" },
            { v: "price", label: "낮은 가격순" },
            { v: "departure", label: "빠른 출발순" },
          ]}
        />
        <div className="flex flex-col justify-end gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="confirmed" value="1" defaultChecked={q.confirmedOnly} className="h-4 w-4 accent-sea-700" />
            출발 확정만
          </label>
          <button className="btn-primary py-2">적용</button>
        </div>
      </form>

      <p className="mt-6 text-sm text-slate-500">
        상품 <b className="text-ink">{result.total}</b>개
      </p>
      {result.items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-slate-300 p-10 text-center">
          <p className="font-medium">조건에 맞는 상품이 없어요.</p>
          <p className="mt-1 text-sm text-slate-500">출발 월이나 요금 조건을 넓혀 보세요.</p>
          <Link href="/tours" className="btn-line mt-4">조건 지우기</Link>
        </div>
      ) : (
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {result.items.map((t) => (
            <TourCard key={t.code} t={t} />
          ))}
        </div>
      )}

      {result.pages > 1 && (
        <nav aria-label="페이지" className="mt-8 flex justify-center gap-1">
          {Array.from({ length: result.pages }, (_, i) => i + 1).map((n) => (
            <Link
              key={n}
              href={pageHref(n)}
              aria-current={n === result.page ? "page" : undefined}
              className={`min-w-9 rounded-md px-3 py-1.5 text-center text-sm ${n === result.page ? "bg-sea-700 font-semibold text-white" : "hover:bg-slate-100"}`}
            >
              {n}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

function Select(props: { name: string; label: string; value?: string; options: { v: string; label: string }[]; all?: boolean }) {
  return (
    <label className="block">
      <span className="label text-xs">{props.label}</span>
      <select name={props.name} defaultValue={props.value ?? ""} className="field py-2">
        {props.all !== false && <option value="">전체</option>}
        {props.options.map((o) => (
          <option key={o.v} value={o.v}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
