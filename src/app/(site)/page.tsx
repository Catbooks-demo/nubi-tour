import Link from "next/link";
import { BoardingPassSearch } from "@/components/BoardingPassSearch";
import { RegionArt } from "@/components/RegionArt";
import { TourCard } from "@/components/TourCard";
import { dateShort, won } from "@/lib/format";
import { homeData } from "@/server/catalog";

export const dynamic = "force-dynamic";

export default async function Home() {
  const h = await homeData();
  return (
    <>
      <section className="bg-sea-800 px-4 pb-14 pt-12 text-white sm:pt-16">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-[42px]">
            가 보고 싶던 곳,
            <br />
            일정은 저희가 꿰어 둘게요
          </h1>
          <p className="mt-3 max-w-xl text-sea-100">
            항공·호텔·식사·입장료를 묶은 패키지여행이에요. 출발 확정 여부와 남은 좌석을 날짜마다 그대로 보여 드려요.
          </p>
        </div>
        <div className="mt-8">
          <BoardingPassSearch regions={h.regions} />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-12">
        <h2 className="text-xl font-bold">지역별로 보기</h2>
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {h.regions.map((r) => (
            <li key={r.code}>
              <Link href={`/tours?region=${r.code}`} className="group block overflow-hidden rounded-xl border border-slate-200">
                <RegionArt region={r.code} className="aspect-[4/3] w-full" />
                <div className="flex items-baseline justify-between px-3 py-2">
                  <span className="font-semibold group-hover:text-sea-700">{r.name}</span>
                  <span className="text-xs text-slate-500">{r.count}개 상품</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {h.confirmed.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pt-12">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-bold">출발이 확정된 날짜</h2>
            <Link href="/tours?confirmed=1" className="text-sm text-slate-500 hover:text-sea-700">전체 보기</Link>
          </div>
          <p className="mt-1 text-sm text-slate-500">최소 인원이 모여 여행사 사정으로 취소되지 않는 출발일이에요.</p>
          <ul className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-200">
            {h.confirmed.map(({ tour, departure }) => (
              <li key={departure.id}>
                <Link href={`/tours/${tour.code}?d=${departure.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-sea-50">
                  <span className="w-24 font-semibold tabular-nums text-sea-800">{dateShort(departure.depart_date)}</span>
                  <span className="flex-1 font-medium">{tour.name}</span>
                  <span className="text-sm text-slate-500">남은 좌석 {departure.seats_left}석</span>
                  <span className="price">{won(departure.price_adult)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {h.themes.map((t) => (
        <section key={t.code} className="mx-auto max-w-6xl px-4 pt-12">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-bold">{t.title}</h2>
            <Link href={`/tours?theme=${t.code}`} className="text-sm text-slate-500 hover:text-sea-700">더 보기</Link>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {t.items.map((tour) => (
              <TourCard key={tour.code} t={tour} />
            ))}
          </div>
        </section>
      ))}

      <section className="mx-auto max-w-6xl px-4 pt-12">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-bold">공지사항</h2>
          <Link href="/support/notices" className="text-sm text-slate-500 hover:text-sea-700">전체 보기</Link>
        </div>
        <ul className="mt-3 divide-y divide-slate-200 border-y border-slate-200">
          {h.notices.map((n) => (
            <li key={n.id}>
              <Link href={`/support/notices#${n.id}`} className="flex gap-2 py-3 text-sm hover:text-sea-700">
                {n.pinned && <span className="badge bg-sea-50 text-sea-700 ring-sea-200">중요</span>}
                {n.title}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
