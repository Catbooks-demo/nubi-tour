/** 한국 시간 날짜 계산. 저장은 UTC, 날짜 판단은 Asia/Seoul. */
const KST_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 그 시각의 한국 날짜 (YYYY-MM-DD). */
export function kstDate(d: Date): string {
  return KST_FMT.format(d);
}

/** YYYY-MM-DD에 n일 더하기 (달력 날짜 계산, 시간대 없음). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 두 날짜(YYYY-MM-DD)의 일 수 차 (b − a). */
export function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** 출발일까지 남은 날 수 (한국 날짜 기준). 당일 0, 출발 뒤 음수. */
export function daysBefore(departureDate: string, at: Date): number {
  return diffDays(kstDate(at), departureDate);
}

/** 요일 (0=일 … 6=토). */
export function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 한국 날짜의 그 시각을 UTC Date로. */
export function kstDateTime(date: string, h = 0, mi = 0, s = 0): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, h - 9, mi, s));
}

/** 한국 날짜의 23:59:59 (그날이 끝나는 시각). */
export function kstEndOfDay(date: string): Date {
  return kstDateTime(date, 23, 59, 59);
}
