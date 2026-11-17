import { addDays, kstDate } from "@/rules/time";

/** 메인 검색: 항공권 모양. 왼쪽은 어디로·언제, 오른쪽 떼는 쪽은 검색 버튼. */
export function BoardingPassSearch({ regions }: { regions: { code: string; name: string }[] }) {
  const today = kstDate(new Date());
  const months = Array.from(new Set(Array.from({ length: 4 }, (_, i) => addDays(today, i * 30 + 3).slice(0, 7))));
  return (
    <form action="/tours" className="relative mx-auto flex max-w-4xl flex-col overflow-hidden rounded-2xl bg-white text-ink shadow-[0_24px_60px_-20px_rgba(12,50,73,.55)] sm:flex-row">
      <div className="flex-1 p-5 sm:p-6">
        <p className="text-xs font-semibold text-sea-600">ICN 인천 출발</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-[1.4fr_1fr_1fr]">
          <label className="block">
            <span className="label">어디로 갈까요</span>
            <input name="q" placeholder="도시·나라 (예: 다낭, 스위스)" className="field" />
          </label>
          <label className="block">
            <span className="label">지역</span>
            <select name="region" className="field" defaultValue="">
              <option value="">전체</option>
              {regions.map((r) => (
                <option key={r.code} value={r.code}>{r.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">출발 월</span>
            <select name="month" className="field" defaultValue="">
              <option value="">언제든</option>
              {months.map((m) => (
                <option key={m} value={m}>{Number(m.slice(5))}월</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {/* 절취선 */}
      <div aria-hidden="true" className="relative hidden w-0 border-l-2 border-dashed border-slate-200 sm:block">
        <span className="absolute -left-[11px] -top-[10px] h-5 w-5 rounded-full bg-sea-800" />
        <span className="absolute -bottom-[10px] -left-[11px] h-5 w-5 rounded-full bg-sea-800" />
      </div>
      <div className="flex items-center justify-center border-t-2 border-dashed border-slate-200 p-5 sm:w-48 sm:border-t-0">
        <button className="btn-primary w-full py-3 text-base">상품 찾기</button>
      </div>
    </form>
  );
}
