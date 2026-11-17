import Link from "next/link";
import { PageTitle, Table, Td } from "@/components/admin/ui";
import { dateShort, dateTimeKo, won } from "@/lib/format";
import { db } from "@/server/db";

export const metadata = { title: "취소 요청" };

export default async function Cancellations() {
  const rows = await db.cancellation.findMany({
    where: { status: "requested" },
    include: { booking: { include: { departure: { include: { product: true } } } } },
    orderBy: { created_at: "asc" },
  });
  const recent = await db.cancellation.findMany({
    where: { status: { not: "requested" } },
    include: { booking: true },
    orderBy: { updated_at: "desc" },
    take: 20,
  });
  return (
    <>
      <PageTitle title={`처리할 취소 요청 ${rows.length}건`} />
      <Table head={["요청 시각", "예약", "상품", "출발", "출발까지", "수수료", "환불 예정", "사유"]} empty={rows.length === 0}>
        {rows.map((c) => (
          <tr key={c.id}>
            <Td>{dateTimeKo(c.created_at.toISOString())}</Td>
            <Td><Link href={`/admin/bookings/${c.booking.code}`} className="text-sea-700 underline">{c.booking.code}</Link></Td>
            <Td className="max-w-56 truncate">{c.booking.departure.product.name}</Td>
            <Td>{dateShort(c.booking.departure.depart_date)}</Td>
            <Td>{c.days_before}일</Td>
            <Td className="tabular-nums">{won(c.fee)}</Td>
            <Td className="tabular-nums">{won(c.refund)}</Td>
            <td className="px-3 py-2">{c.reason}</td>
          </tr>
        ))}
      </Table>
      <h2 className="mb-2 mt-8 font-bold">최근 처리</h2>
      <Table head={["처리 시각", "예약", "결과", "수수료", "환불", "메모"]} empty={recent.length === 0}>
        {recent.map((c) => (
          <tr key={c.id}>
            <Td>{dateTimeKo((c.decided_at ?? c.updated_at).toISOString())}</Td>
            <Td><Link href={`/admin/bookings/${c.booking.code}`} className="text-sea-700 underline">{c.booking.code}</Link></Td>
            <Td>{c.status === "done" ? "취소 완료" : "거절"}</Td>
            <Td className="tabular-nums">{won(c.fee)}</Td>
            <Td className="tabular-nums">{won(c.refund)}</Td>
            <td className="px-3 py-2 text-slate-600">{c.decide_note ?? c.reason}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
