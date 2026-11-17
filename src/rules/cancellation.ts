/**
 * 손님 취소 수수료 (국외여행 표준약관 기준, 여행 요금 총액 대비).
 * 30일 전까지 0% / 29~20일 전 10% / 19~10일 전 15% / 9~8일 전 20% / 7~1일 전 30% / 당일 50% / 출발 뒤 100%.
 */
export function cancellationRate(daysBefore: number): number {
  if (daysBefore >= 30) return 0;
  if (daysBefore >= 20) return 0.1;
  if (daysBefore >= 10) return 0.15;
  if (daysBefore >= 8) return 0.2;
  if (daysBefore >= 1) return 0.3;
  if (daysBefore === 0) return 0.5;
  return 1;
}

export function cancellationFee(total: number, daysBefore: number): { rate: number; fee: number } {
  const rate = cancellationRate(daysBefore);
  return { rate, fee: Math.floor(total * rate) };
}

/** 환불액 = 낸 금액 − 수수료. 모자란 수수료는 청구하지 않는다. */
export function refundAmount(paid: number, fee: number): number {
  return Math.max(0, paid - fee);
}

export const CANCELLATION_TABLE = [
  { label: "출발 30일 전까지", rate: 0 },
  { label: "출발 29~20일 전", rate: 0.1 },
  { label: "출발 19~10일 전", rate: 0.15 },
  { label: "출발 9~8일 전", rate: 0.2 },
  { label: "출발 7~1일 전", rate: 0.3 },
  { label: "출발 당일", rate: 0.5 },
] as const;
