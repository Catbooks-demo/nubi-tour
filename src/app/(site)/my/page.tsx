import type { Prisma } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/AuthForms";
import { dateKo, won } from "@/lib/format";
import { BOOKING_STATUS_KO, type BookingStatus } from "@/rules/status";
import { currentUser } from "@/server/auth/current";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "마이페이지" };

const TONE: Partial<Record<BookingStatus, string>> = {
  pending_deposit: "bg-dusk-400/15 text-dusk-600 ring-dusk-400/40",
  pending_full: "bg-dusk-400/15 text-dusk-600 ring-dusk-400/40",
  deposit_paid: "bg-sea-50 text-sea-700 ring-sea-200",
  fully_paid: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

export default async function MyPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/my");
  const [bookings, openInquiries] = await Promise.all([
    db.booking.findMany({
      where: { user_id: user.id },
      include: { departure: { include: { product: true } } },
      orderBy: { created_at: "desc" },
    }),
    db.inquiry.count({ where: { user_id: user.id, status: "answered" } }),
  ]);
  const upcoming = bookings.filter((b) => ["pending_deposit", "pending_full", "deposit_paid", "fully_paid", "cancel_requested"].includes(b.status));
  const past = bookings.filter((b) => !upcoming.includes(b));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{user.name}님의 여행</h1>
          <p className="mt-1 text-sm text-slate-500">{user.email} · {user.phone}</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/my/inquiries" className="underline">1:1 문의 내역{openInquiries ? ` (답변 ${openInquiries})` : ""}</Link>
          <LogoutButton />
        </div>
      </div>

      <BookingList title="다가오는 여행" items={upcoming} empty={<>아직 예약한 여행이 없어요. <Link href="/tours" className="underline">상품 보러 가기</Link></>} />
      {past.length > 0 && <BookingList title="지난 예약" items={past} />}
    </div>
  );
}

type Item = Prisma.BookingGetPayload<{ include: { departure: { include: { product: true } } } }>;

function BookingList({ title, items, empty }: { title: string; items: Item[]; empty?: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((b) => (
            <li key={b.id}>
              <Link href={`/bookings/${b.code}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-200 px-4 py-3 hover:border-sea-300">
                <span className={`badge ${TONE[b.status as BookingStatus] ?? "bg-slate-100 text-slate-500 ring-slate-200"}`}>{BOOKING_STATUS_KO[b.status as BookingStatus]}</span>
                <span className="flex-1 font-medium">{b.departure.product.name}</span>
                <span className="text-sm text-slate-500">{dateKo(b.departure.depart_date)} 출발</span>
                <span className="text-sm tabular-nums">{won(b.total_amount)}</span>
                <span className="w-full text-xs text-slate-400">예약번호 {b.code}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
