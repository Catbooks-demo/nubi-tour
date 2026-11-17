export type DepartureStatus = "open" | "confirmed" | "closed" | "cancelled" | "departed";

export const DEPARTURE_STATUS_KO: Record<DepartureStatus, string> = {
  open: "예약 가능",
  confirmed: "출발 확정",
  closed: "마감",
  cancelled: "출발 취소",
  departed: "출발 완료",
};

/**
 * 출발일 상태 다시 계산. cancelled·departed는 그대로.
 * 좌석이 다 차면 closed, 예약금 이상 낸 좌석이 최소 인원을 넘으면 confirmed, 아니면 open.
 * (closed여도 확정 조건을 채웠는지는 화면에서 따로 보여 줄 수 있게 confirmedFlag를 함께 쓴다.)
 */
export function departureStatus(d: {
  capacity: number;
  min_pax: number;
  seats_taken: number;
  paidSeats: number;
  current: string;
}): DepartureStatus {
  if (d.current === "cancelled" || d.current === "departed") return d.current;
  if (d.seats_taken >= d.capacity) return "closed";
  if (d.paidSeats >= d.min_pax) return "confirmed";
  return "open";
}

/** 출발이 확정됐는지 (마감이어도 인원이 찼으면 확정). */
export function isConfirmed(d: { min_pax: number; paidSeats: number; status: string }): boolean {
  return d.status !== "cancelled" && d.paidSeats >= d.min_pax;
}
