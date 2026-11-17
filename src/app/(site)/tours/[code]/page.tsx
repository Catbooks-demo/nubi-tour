import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DepartureCalendar } from "@/components/DepartureCalendar";
import { RegionArt } from "@/components/RegionArt";
import { dateKo, nightsDays, won } from "@/lib/format";
import { CANCELLATION_TABLE } from "@/rules/cancellation";
import { getTour } from "@/server/catalog";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ code: string }>; searchParams: Promise<{ d?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTour((await params).code);
  return { title: t?.product.name ?? "상품" };
}

export default async function TourPage({ params, searchParams }: Props) {
  const [{ code }, { d }] = await Promise.all([params, searchParams]);
  const tour = await getTour(code);
  if (!tour) notFound();
  const p = tour.product;
  const optional = (p.optional_tours as { name: string; price: string; note?: string }[]) ?? [];
  const minPrice = tour.departures.filter((x) => x.bookable).reduce<number | null>((m, x) => (m === null || x.price_adult < m ? x.price_adult : m), null);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <nav aria-label="경로" className="text-sm text-slate-500">
        <Link href="/" className="hover:underline">홈</Link> ›{" "}
        <Link href={`/tours?region=${p.region.code}`} className="hover:underline">{p.region.name}</Link>
        {p.country !== p.region.name && <> › {p.country}</>}
      </nav>

      <div className="mt-3 grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0">
          <div className="overflow-hidden rounded-2xl">
            <RegionArt region={p.region.code} seed={p.code} className="aspect-[2.2/1] w-full" />
          </div>
          <p className="mt-5 text-sm font-medium text-sea-700">상품 코드 {p.code}</p>
          <h1 className="mt-1 text-2xl font-extrabold leading-snug tracking-tight sm:text-3xl">{p.name}</h1>
          <p className="mt-3 text-slate-700">{p.summary}</p>

          <dl className="mt-5 grid grid-cols-2 gap-3 rounded-xl border border-slate-200 p-4 text-sm sm:grid-cols-4">
            <Fact label="여행 기간" value={nightsDays(p.nights, p.days)} />
            <Fact label="항공" value={`${p.airline} · ${p.departure_airport} 출발`} />
            <Fact label="쇼핑" value={p.shopping_count ? `${p.shopping_count}회` : "없음 (노쇼핑)"} />
            <Fact label="안내" value={p.guide} />
          </dl>

          <ul className="mt-4 flex flex-wrap gap-2">
            {p.themes.map((t) => (
              <li key={t.theme.code}>
                <Link href={`/tours?theme=${t.theme.code}`} className="badge bg-white text-slate-600 ring-slate-300 hover:ring-sea-400">{t.theme.name}</Link>
              </li>
            ))}
          </ul>

          <Section title="이런 걸 해요">
            <ul className="grid gap-2 sm:grid-cols-3">
              {p.highlights.map((h) => (
                <li key={h} className="rounded-lg bg-sea-50 px-3 py-3 font-medium text-sea-900">{h}</li>
              ))}
            </ul>
          </Section>

          <Section title="일정표">
            <ol className="space-y-2">
              {p.itinerary.map((day) => (
                <li key={day.day}>
                  <details className="group rounded-xl border border-slate-200 open:border-sea-200" open={day.day === 1}>
                    <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
                      <span className="flex h-8 w-14 shrink-0 items-center justify-center rounded-md bg-sea-700 text-sm font-bold text-white">{day.day}일차</span>
                      <span className="flex-1">
                        <span className="font-semibold">{day.title}</span>
                        <span className="ml-2 text-sm text-slate-500">{day.city}</span>
                      </span>
                      <span className="text-slate-400 transition-transform group-open:rotate-180" aria-hidden="true">▾</span>
                    </summary>
                    <div className="border-t border-slate-100 px-4 py-3 text-sm">
                      <ul className="list-disc space-y-1 pl-5 text-slate-700">
                        {day.details.map((x) => <li key={x}>{x}</li>)}
                      </ul>
                      <dl className="mt-3 grid gap-1 text-slate-600 sm:grid-cols-2">
                        <div className="flex gap-2"><dt className="w-10 shrink-0 text-slate-400">식사</dt><dd>아침 {day.breakfast} · 점심 {day.lunch} · 저녁 {day.dinner}</dd></div>
                        <div className="flex gap-2"><dt className="w-10 shrink-0 text-slate-400">숙소</dt><dd>{day.hotel}</dd></div>
                      </dl>
                    </div>
                  </details>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-slate-500">현지 사정과 항공 시간에 따라 일정 순서가 바뀔 수 있어요.</p>
          </Section>

          <Section title="포함·불포함">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-4">
                <h3 className="font-semibold text-sea-800">포함</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{p.includes.map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <h3 className="font-semibold text-slate-700">불포함</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{p.excludes.map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
            </div>
          </Section>

          {optional.length > 0 && (
            <Section title="선택관광">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500"><tr><th className="py-1 font-medium">이름</th><th className="py-1 font-medium">현지 요금</th><th className="py-1 font-medium">참고</th></tr></thead>
                <tbody>
                  {optional.map((o) => (
                    <tr key={o.name} className="border-t border-slate-100"><td className="py-2">{o.name}</td><td className="py-2 tabular-nums">{o.price}</td><td className="py-2 text-slate-500">{o.note ?? "-"}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-slate-500">선택관광은 원하는 분만 현지에서 신청하고 내요. 참여하지 않아도 불이익은 없어요.</p>
            </Section>
          )}

          <Section title="여권·비자">
            <p className="text-sm text-slate-700">{p.travel_docs}</p>
          </Section>

          <Section title="취소 수수료">
            <table className="w-full text-sm">
              <tbody>
                {CANCELLATION_TABLE.map((r) => (
                  <tr key={r.label} className="border-t border-slate-100 first:border-t-0">
                    <td className="py-2">{r.label}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{r.rate === 0 ? "수수료 없음" : `여행 요금의 ${Math.round(r.rate * 100)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-500">국외여행 표준약관 기준이에요. 최소 인원이 모이지 않아 여행사가 출발을 취소하면 낸 금액을 모두 돌려드려요.</p>
          </Section>

          <Section title={`여행 후기${tour.rating ? ` ★ ${tour.rating.toFixed(1)}` : ""}`}>
            {tour.reviews.length === 0 ? (
              <p className="text-sm text-slate-500">아직 후기가 없어요. 다녀오신 분은 마이페이지에서 남길 수 있어요.</p>
            ) : (
              <ul className="space-y-3">
                {tour.reviews.map((r, i) => (
                  <li key={i} className="rounded-xl border border-slate-200 p-4">
                    <p className="text-sm"><span className="text-dusk-500" aria-label={`별점 ${r.rating}점`}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span> <span className="text-slate-500">{r.name} · {dateKo(r.created_at.slice(0, 10))}</span></p>
                    <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{r.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-2xl border border-slate-200 p-5">
            <p className="text-sm text-slate-500">1인 요금 (성인 기준)</p>
            <p className="mt-0.5"><span className="price text-2xl">{minPrice ? won(minPrice) : "-"}</span>{minPrice && <span className="text-sm text-slate-500"> 부터</span>}</p>
            <h2 className="mt-5 font-bold">출발일 고르기</h2>
            <div className="mt-3">
              <DepartureCalendar departures={tour.departures} initialId={d} />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-semibold">{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="mb-3 text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}
