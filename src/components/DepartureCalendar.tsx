"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { DEPARTURE_BADGE, dateKo, won } from "@/lib/format";
import type { DepartureView } from "@/server/catalog";

const WD = ["일", "월", "화", "수", "목", "금", "토"];

function monthGrid(month: string): (string | null)[] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array(first).fill(null);
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}

const manwon = (n: number) => `${Math.round(n / 10000)}만`;

function unavailableLabel(d: DepartureView): string {
  if (d.status === "cancelled") return "취소";
  if (d.status === "closed" || d.seats_left === 0) return "마감";
  return "전화";
}

/** 출발일 달력: 날짜마다 1인 요금·상태, 고르면 아래에 항공권 모양 요약과 예약 버튼. */
export function DepartureCalendar({ departures, initialId }: { departures: DepartureView[]; initialId?: string }) {
  const months = useMemo(() => [...new Set(departures.map((d) => d.depart_date.slice(0, 7)))], [departures]);
  const byDate = useMemo(() => new Map(departures.map((d) => [d.depart_date, d])), [departures]);
  const initial = departures.find((d) => d.id === initialId) ?? departures.find((d) => d.bookable) ?? null;
  const [selected, setSelected] = useState<DepartureView | null>(initial);
  const [month, setMonth] = useState(initial?.depart_date.slice(0, 7) ?? months[0]);

  if (!departures.length) {
    return <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-500">지금 예약할 수 있는 출발일이 없어요. 고객센터로 문의해 주세요.</p>;
  }

  return (
    <div>
      <div role="tablist" aria-label="출발 월" className="flex gap-1 overflow-x-auto">
        {months.map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={m === month}
            onClick={() => setMonth(m)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold ${m === month ? "bg-sea-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            {Number(m.slice(5))}월
          </button>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs" role="grid" aria-label={`${Number(month.slice(5))}월 출발일`}>
        {WD.map((w, i) => (
          <div key={w} className={`py-1 font-medium ${i === 0 ? "text-rose-500" : i === 6 ? "text-sea-600" : "text-slate-500"}`}>{w}</div>
        ))}
        {monthGrid(month).map((date, i) => {
          if (!date) return <div key={`e${i}`} />;
          const d = byDate.get(date);
          const day = Number(date.slice(8));
          if (!d) return <div key={date} className="rounded-md py-2 text-slate-300">{day}</div>;
          const isSel = selected?.id === d.id;
          return (
            <button
              key={date}
              onClick={() => setSelected(d)}
              aria-pressed={isSel}
              data-date={date}
              data-bookable={d.bookable}
              aria-label={`${dateKo(date)} ${DEPARTURE_BADGE[d.status]?.label ?? ""} ${won(d.price_adult)}`}
              className={`flex flex-col items-center rounded-md border py-1.5 ${
                isSel ? "border-sea-700 bg-sea-700 text-white" : d.bookable ? "border-sea-100 bg-sea-50 hover:border-sea-400" : "border-slate-100 bg-slate-50 text-slate-400"
              }`}
            >
              <span className="font-semibold">{day}</span>
              <span className={`tabular-nums ${isSel ? "text-white" : d.bookable ? "text-dusk-600" : ""}`}>{d.bookable ? manwon(d.price_adult) : unavailableLabel(d)}</span>
              {d.status === "confirmed" && <span className={`mt-0.5 h-1 w-1 rounded-full ${isSel ? "bg-white" : "bg-emerald-500"}`} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-slate-500">초록 점은 출발 확정이에요. 출발 2일 이내 날짜는 전화로만 예약할 수 있어요.</p>

      {selected && (
        <div className="mt-5 overflow-hidden rounded-xl border border-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-sea-50 px-4 py-3">
            <div>
              <p className="font-bold text-sea-900">
                {dateKo(selected.depart_date)} 출발 → {dateKo(selected.return_date)} 도착
              </p>
              <p className="text-sm text-slate-600">
                최소 출발 {selected.min_pax}명 · 남은 좌석 {selected.seats_left}석
              </p>
            </div>
            <span className={`badge ${DEPARTURE_BADGE[selected.status]?.tone}`}>{DEPARTURE_BADGE[selected.status]?.label}</span>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t-2 border-dashed border-slate-200 px-4 py-3 text-sm">
            <div><dt className="text-slate-500">성인</dt><dd className="price text-base">{won(selected.price_adult)}</dd></div>
            <div><dt className="text-slate-500">아동 (만 12세 미만)</dt><dd className="font-semibold tabular-nums">{won(selected.price_child)}</dd></div>
            <div><dt className="text-slate-500">유아 (만 2세 미만)</dt><dd className="font-semibold tabular-nums">{won(selected.price_infant)}</dd></div>
            <div><dt className="text-slate-500">싱글룸 추가</dt><dd className="font-semibold tabular-nums">{selected.single_supplement ? won(selected.single_supplement) : "없음"}</dd></div>
          </dl>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
            <p className="text-xs text-slate-500">예약금 1인 {won(selected.deposit_per_person)} · 유류할증료 포함 · 잔금은 출발 7일 전까지</p>
            {selected.bookable ? (
              <Link href={`/book/${selected.id}`} className="btn-pay px-6">이 날짜로 예약하기</Link>
            ) : (
              <span className="btn bg-slate-100 text-slate-500">온라인 예약 불가</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
