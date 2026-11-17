export type BookingStatus =
  | "pending_deposit"
  | "pending_full"
  | "deposit_paid"
  | "fully_paid"
  | "completed"
  | "cancel_requested"
  | "cancelled"
  | "expired";

export const BOOKING_STATUS_KO: Record<BookingStatus, string> = {
  pending_deposit: "예약금 결제 대기",
  pending_full: "결제 대기",
  deposit_paid: "예약금 완료",
  fully_paid: "결제 완료",
  completed: "여행 완료",
  cancel_requested: "취소 요청",
  cancelled: "취소 완료",
  expired: "기한 만료 취소",
};

const NEXT: Record<BookingStatus, BookingStatus[]> = {
  pending_deposit: ["deposit_paid", "expired", "cancelled"],
  pending_full: ["fully_paid", "expired", "cancelled"],
  deposit_paid: ["fully_paid", "cancel_requested", "cancelled"],
  fully_paid: ["completed", "cancel_requested", "cancelled"],
  cancel_requested: ["cancelled", "deposit_paid", "fully_paid"],
  completed: [],
  cancelled: [],
  expired: [],
};

/** 상태를 바꿔도 되는지. 취소 요청은 승인(cancelled)이나 거절(직전 상태로)만. */
export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return NEXT[from]?.includes(to) ?? false;
}

/** 좌석을 잡고 있는 상태 (취소·만료 전). */
export const LIVE_STATUSES: BookingStatus[] = [
  "pending_deposit",
  "pending_full",
  "deposit_paid",
  "fully_paid",
  "cancel_requested",
];

/** 예약금 이상 낸 상태 (출발 확정 셈에 들어간다). */
export const PAID_STATUSES: BookingStatus[] = ["deposit_paid", "fully_paid"];

export function isBookingStatus(s: string): s is BookingStatus {
  return s in NEXT;
}
