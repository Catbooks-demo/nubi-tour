import { departureStatus } from "@/rules/departure";
import { PAID_STATUSES } from "@/rules/status";
import type { Tx } from "./tx";

/** 예약금 이상 낸 좌석 수 (성인+아동). */
export async function paidSeats(tx: Tx, departureId: string): Promise<number> {
  const agg = await tx.booking.aggregate({
    where: { departure_id: departureId, status: { in: PAID_STATUSES } },
    _sum: { adults: true, children: true },
  });
  return (agg._sum.adults ?? 0) + (agg._sum.children ?? 0);
}

/** 출발일 상태를 다시 계산해 바뀌었으면 저장. 새 상태를 돌려준다. */
export async function refreshDepartureStatus(tx: Tx, departureId: string): Promise<string> {
  const d = await tx.departure.findUniqueOrThrow({ where: { id: departureId } });
  const next = departureStatus({
    capacity: d.capacity,
    min_pax: d.min_pax,
    seats_taken: d.seats_taken,
    paidSeats: await paidSeats(tx, departureId),
    current: d.status,
  });
  if (next !== d.status) await tx.departure.update({ where: { id: departureId }, data: { status: next } });
  return next;
}

/** 출발일 행 잠금 (같은 출발일 예약·취소를 한 줄로 세운다). */
export async function lockDeparture(tx: Tx, departureId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM departures WHERE id = ${departureId} FOR UPDATE`;
}
