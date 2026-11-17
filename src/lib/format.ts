/** 화면 표기 (서버·브라우저 공용). */
export const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

const WD = ["일", "월", "화", "수", "목", "금", "토"];

/** 2026-12-01 → 12월 1일 (화) */
export function dateKo(date: string, withYear = false): string {
  const [y, m, d] = date.split("-").map(Number);
  const wd = WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${withYear ? `${y}년 ` : ""}${m}월 ${d}일 (${wd})`;
}

/** 2026-12-01 → 12.01(화) */
export function dateShort(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const wd = WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")}(${wd})`;
}

/** ISO 시각 → 한국 시간 "11월 18일 14:05" */
export function dateTimeKo(iso: string): string {
  const t = new Date(iso);
  const p = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(t);
  const get = (k: string) => p.find((x) => x.type === k)?.value ?? "";
  return `${get("month")}월 ${get("day")}일 ${get("hour")}:${get("minute")}`;
}

export const nightsDays = (n: number, d: number) => `${n}박 ${d}일`;

export const DEPARTURE_BADGE: Record<string, { label: string; tone: string }> = {
  open: { label: "예약 가능", tone: "bg-sea-50 text-sea-700 ring-sea-200" },
  confirmed: { label: "출발 확정", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  closed: { label: "마감", tone: "bg-slate-100 text-slate-500 ring-slate-200" },
  cancelled: { label: "출발 취소", tone: "bg-slate-100 text-slate-500 ring-slate-200" },
  departed: { label: "출발 완료", tone: "bg-slate-100 text-slate-500 ring-slate-200" },
};
