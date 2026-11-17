import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingForm } from "@/components/BookingForm";
import { dateKo, nightsDays } from "@/lib/format";
import { paymentPlan } from "@/rules/schedule";
import { currentUser } from "@/server/auth/current";
import { isBookable } from "@/server/catalog";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "예약하기" };

export default async function BookPage({ params }: { params: Promise<{ departureId: string }> }) {
  const { departureId } = await params;
  const dep = await db.departure.findUnique({ where: { id: departureId }, include: { product: true } });
  if (!dep || !dep.product.on_sale) notFound();
  const user = await currentUser();
  const bookable = isBookable(dep);
  const mode = paymentPlan(dep.depart_date, new Date(), 1, 1, dep.deposit_per_person).mode;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link href={`/tours/${dep.product.code}?d=${dep.id}`} className="text-sm text-slate-500 hover:underline">상품으로 돌아가기</Link>
      <h1 className="mt-2 text-2xl font-bold">예약하기</h1>
      <div className="mt-4 rounded-xl border border-slate-200 bg-sea-50 p-4">
        <p className="font-semibold text-sea-900">{dep.product.name}</p>
        <p className="mt-1 text-sm text-slate-600">
          {dateKo(dep.depart_date, true)} 출발 · {nightsDays(dep.product.nights, dep.product.days)} · {dep.product.airline} · 남은 좌석 {Math.max(0, dep.capacity - dep.seats_taken)}석
        </p>
      </div>
      {!bookable ? (
        <div className="mt-6 rounded-xl border border-dashed border-slate-300 p-8 text-center">
          <p className="font-medium">이 출발일은 온라인으로 예약할 수 없어요.</p>
          <p className="mt-1 text-sm text-slate-500">마감됐거나 출발이 2일 이내예요. 다른 날짜를 골라 주세요.</p>
          <Link href={`/tours/${dep.product.code}`} className="btn-line mt-4">다른 날짜 보기</Link>
        </div>
      ) : (
        <BookingForm
          departure={{
            id: dep.id,
            depart_date: dep.depart_date,
            seats_left: dep.capacity - dep.seats_taken,
            price_adult: dep.price_adult,
            price_child: dep.price_child,
            price_infant: dep.price_infant,
            single_supplement: dep.single_supplement,
            deposit_per_person: dep.deposit_per_person,
          }}
          payMode={mode === "full" ? "full" : "deposit"}
          member={user ? { name: user.name, phone: user.phone, email: user.email } : null}
        />
      )}
    </div>
  );
}
