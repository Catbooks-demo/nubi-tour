import Link from "next/link";
import { dateShort, nightsDays, won } from "@/lib/format";
import type { TourSummary } from "@/server/catalog";
import { RegionArt } from "./RegionArt";

export function TourCard({ t }: { t: TourSummary }) {
  return (
    <Link href={`/tours/${t.code}`} className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white hover:border-sea-300">
      <div className="relative aspect-[2/1] overflow-hidden">
        <RegionArt region={t.region.code} seed={t.code} className="h-full w-full" />
        <span className="absolute left-3 top-3 rounded-md bg-white/90 px-2 py-0.5 text-xs font-semibold text-sea-800">
          {t.country}
        </span>
        {t.has_confirmed && (
          <span className="absolute right-3 top-3 rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">출발 확정 있음</span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-2 font-bold leading-snug group-hover:text-sea-700">{t.name}</h3>
        <p className="text-sm text-slate-500">
          {nightsDays(t.nights, t.days)} · {t.airline} · {t.shopping_count ? `쇼핑 ${t.shopping_count}회` : "노쇼핑"}
        </p>
        <div className="mt-auto flex items-end justify-between pt-2">
          <span className="text-xs text-slate-500">
            {t.next_departure ? `가장 빠른 출발 ${dateShort(t.next_departure)}` : "예약 가능한 출발일 없음"}
          </span>
          {t.min_price !== null && (
            <span>
              <span className="price text-lg">{won(t.min_price)}</span>
              <span className="text-xs text-slate-500">~</span>
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
