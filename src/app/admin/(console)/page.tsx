import Link from "next/link";
import { Card, PageTitle } from "@/components/admin/ui";
import { dateShort, dateTimeKo, won } from "@/lib/format";
import { addDays, kstDate } from "@/rules/time";
import { dashboardCounts } from "@/server/admin";
import { db } from "@/server/db";

export const metadata = { title: "대시보드" };

export default async function Dashboard() {
  const now = new Date();
  const today = kstDate(now);
  const [c, cancels, inquiries, overdue, pending] = await Promise.all([
    dashboardCounts(now),
    db.booking.findMany({ where: { status: "cancel_requested" }, include: { departure: { include: { product: true } } }, orderBy: { updated_at: "asc" }, take: 5 }),
    db.inquiry.findMany({ where: { status: "open" }, orderBy: { created_at: "asc" }, take: 5 }),
    db.booking.findMany({ where: { status: "deposit_paid", balance_deadline: { lt: now } }, include: { departure: true }, orderBy: { balance_deadline: "asc" }, take: 5 }),
    db.departure.findMany({
      where: { status: "open", depart_date: { gte: today, lte: addDays(today, 14) }, bookings: { some: { status: { in: ["deposit_paid", "fully_paid"] } } } },
      include: { product: true, bookings: { where: { status: { in: ["deposit_paid", "fully_paid"] } } } },
      orderBy: { depart_date: "asc" },
      take: 8,
    }),
  ]);
  const tiles = [
    { label: "오늘 예약", value: `${c.todayBookings}건`, href: "/admin/bookings" },
    { label: "오늘 결제(환불 뺀)", value: won(c.todayPaid), href: "/admin/bookings" },
    { label: "취소 요청", value: `${c.cancelRequests}건`, href: "/admin/cancellations", warn: c.cancelRequests > 0 },
    { label: "답변 대기 문의", value: `${c.openInquiries}건`, href: "/admin/inquiries", warn: c.openInquiries > 0 },
    { label: "잔금 기한 지남", value: `${c.balanceOverdue}건`, href: "/admin/bookings?status=deposit_paid", warn: c.balanceOverdue > 0 },
    { label: "2주 안 출발, 미확정", value: `${c.confirmPending}개`, href: "/admin/tours", warn: c.confirmPending > 0 },
  ];
  return (
    <>
      <PageTitle title="대시보드"><p className="text-sm text-slate-500">{dateShort(today)} 기준</p></PageTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className={`rounded-xl border bg-white p-4 hover:border-sea-300 ${t.warn ? "border-dusk-400" : "border-slate-200"}`}>
            <p className="text-xs text-slate-500">{t.label}</p>
            <p className="mt-1 text-xl font-bold tabular-nums">{t.value}</p>
          </Link>
        ))}
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-bold">처리할 취소 요청</h2>
          <List empty={cancels.length === 0}>
            {cancels.map((b) => (
              <li key={b.id}><Link href={`/admin/bookings/${b.code}`} className="flex justify-between gap-2 py-2 hover:text-sea-700"><span className="truncate">{b.code} · {b.departure.product.name}</span><span className="shrink-0 text-slate-500">{dateShort(b.departure.depart_date)}</span></Link></li>
            ))}
          </List>
        </Card>
        <Card>
          <h2 className="font-bold">답변 대기 문의</h2>
          <List empty={inquiries.length === 0}>
            {inquiries.map((q) => (
              <li key={q.id}><Link href={`/admin/inquiries#${q.id}`} className="flex justify-between gap-2 py-2 hover:text-sea-700"><span className="truncate">{q.title}</span><span className="shrink-0 text-slate-500">{dateTimeKo(q.created_at.toISOString())}</span></Link></li>
            ))}
          </List>
        </Card>
        <Card>
          <h2 className="font-bold">잔금 기한이 지난 예약</h2>
          <p className="text-xs text-slate-500">자동 취소하지 않아요. 손님께 연락한 뒤 처리해 주세요.</p>
          <List empty={overdue.length === 0}>
            {overdue.map((b) => (
              <li key={b.id}><Link href={`/admin/bookings/${b.code}`} className="flex justify-between gap-2 py-2 hover:text-sea-700"><span>{b.code} · {b.contact_name} · {b.contact_phone}</span><span className="text-slate-500">잔금 {won(b.total_amount - b.paid_amount)}</span></Link></li>
            ))}
          </List>
        </Card>
        <Card>
          <h2 className="font-bold">2주 안 출발인데 아직 미확정</h2>
          <List empty={pending.length === 0}>
            {pending.map((d) => {
              const paid = d.bookings.reduce((s, b) => s + b.adults + b.children, 0);
              return (
                <li key={d.id}><Link href={`/admin/tours/${d.product.code}`} className="flex justify-between gap-2 py-2 hover:text-sea-700"><span className="truncate">{dateShort(d.depart_date)} · {d.product.name}</span><span className="shrink-0 tabular-nums text-slate-500">{paid}/{d.min_pax}명</span></Link></li>
              );
            })}
          </List>
        </Card>
      </div>
    </>
  );
}

function List({ children, empty }: { children: React.ReactNode; empty: boolean }) {
  return empty ? <p className="mt-3 text-sm text-slate-400">없어요.</p> : <ul className="mt-2 divide-y divide-slate-100 text-sm">{children}</ul>;
}
