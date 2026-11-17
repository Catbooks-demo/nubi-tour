import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { PageTitle, Pager, Table, Td } from "@/components/admin/ui";
import { dateShort, dateTimeKo, won } from "@/lib/format";
import { BOOKING_STATUS_KO, type BookingStatus } from "@/rules/status";
import { db } from "@/server/db";

export const metadata = { title: "예약" };
const SIZE = 30;

export default async function AdminBookings({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = sp.q?.trim();
  const digits = q?.replace(/[^0-9]/g, "");
  const where: Prisma.BookingWhereInput = {
    ...(sp.status ? { status: sp.status } : {}),
    ...(q
      ? {
          OR: [
            { code: { contains: q.toUpperCase() } },
            { contact_name: { contains: q } },
            ...(digits && digits.length >= 4 ? [{ contact_phone: { contains: digits } }] : []),
            { contact_email: { contains: q.toLowerCase() } },
          ],
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    db.booking.count({ where }),
    db.booking.findMany({ where, include: { departure: { include: { product: true } } }, orderBy: { created_at: "desc" }, skip: (page - 1) * SIZE, take: SIZE }),
  ]);
  const href = (p: number) => `/admin/bookings?${new URLSearchParams({ ...(q ? { q } : {}), ...(sp.status ? { status: sp.status } : {}), page: String(p) })}`;
  return (
    <>
      <PageTitle title={`예약 ${total.toLocaleString("ko-KR")}건`}>
        <form className="flex gap-2">
          <input name="q" defaultValue={q} placeholder="예약번호·이름·전화·이메일" className="field w-56 py-2" />
          <select name="status" defaultValue={sp.status ?? ""} className="field w-40 py-2">
            <option value="">모든 상태</option>
            {Object.entries(BOOKING_STATUS_KO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="btn-primary py-2">찾기</button>
        </form>
      </PageTitle>
      <Table head={["예약번호", "상태", "상품", "출발", "예약자", "인원", "총액", "낸 금액", "예약 시각"]} empty={rows.length === 0}>
        {rows.map((b) => (
          <tr key={b.id} className="hover:bg-slate-50">
            <Td><Link href={`/admin/bookings/${b.code}`} className="font-medium text-sea-700 underline">{b.code}</Link></Td>
            <Td>{BOOKING_STATUS_KO[b.status as BookingStatus]}</Td>
            <Td className="max-w-64 truncate">{b.departure.product.name}</Td>
            <Td>{dateShort(b.departure.depart_date)}</Td>
            <Td>{b.contact_name}{!b.user_id && <span className="ml-1 text-xs text-slate-400">비회원</span>}</Td>
            <Td>{b.adults + b.children + b.infants}명</Td>
            <Td className="tabular-nums">{won(b.total_amount)}</Td>
            <Td className="tabular-nums">{won(b.paid_amount)}</Td>
            <Td className="text-slate-500">{dateTimeKo(b.created_at.toISOString())}</Td>
          </tr>
        ))}
      </Table>
      <Pager page={page} pages={Math.ceil(total / SIZE)} href={href} />
    </>
  );
}
