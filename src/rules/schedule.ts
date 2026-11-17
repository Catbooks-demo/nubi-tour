import { addDays, daysBefore, kstEndOfDay } from "./time";

export type PayMode = "deposit" | "full" | "closed";

export interface PaymentPlan {
  mode: PayMode;
  firstAmount: number;
  payDeadline: Date;
  balanceDeadline: Date | null;
}

const DAY_MS = 86_400_000;

/**
 * 결제 계획.
 * - 출발 8일 이상 남음: 예약금(좌석 인원 × 1인 예약금, 총액을 넘지 않음), 24시간 기한, 잔금은 출발 7일 전 23:59:59(KST)까지.
 * - 7일 이내: 총액 한 번에, 기한은 24시간과 출발 전날 23:59:59(KST) 중 이른 쪽.
 * - 2일 이내: 온라인 예약 불가.
 */
export function paymentPlan(
  departureDate: string,
  at: Date,
  total: number,
  seats: number,
  depositPerPerson: number,
): PaymentPlan {
  const left = daysBefore(departureDate, at);
  const in24h = new Date(at.getTime() + DAY_MS);
  if (left <= 2) return { mode: "closed", firstAmount: 0, payDeadline: at, balanceDeadline: null };
  if (left >= 8) {
    return {
      mode: "deposit",
      firstAmount: Math.min(total, depositPerPerson * seats),
      payDeadline: in24h,
      balanceDeadline: kstEndOfDay(addDays(departureDate, -7)),
    };
  }
  const dayBefore = kstEndOfDay(addDays(departureDate, -1));
  return {
    mode: "full",
    firstAmount: total,
    payDeadline: in24h < dayBefore ? in24h : dayBefore,
    balanceDeadline: null,
  };
}
