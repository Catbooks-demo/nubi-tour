import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CancelPanel } from "@/components/CancelPanel";
import { PayButton } from "@/components/PayButton";
import { ReviewForm } from "@/components/ReviewForm";
import { dateKo, dateTimeKo, won } from "@/lib/format";
import { BOOKING_STATUS_KO, type BookingStatus } from "@/rules/status";
import { bookingView } from "@/server/bookings";
import { db } from "@/server/db";
import { tossEnabled } from "@/server/env";
import { viewerBooking } from "@/server/viewer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "예약 상세" };

const STEPS: { key: BookingStatus[]; label: string }[] = [
  { key: ["pending_deposit", "pending_full"], label: "예약 접수" },
  { key: ["deposit_paid"], label: "예약금 완료" },
  { key: ["fully_paid"], label: "결제 완료" },
  { key: ["completed"], label: "여행 완료" },
];
const PAY_KO: Record<string, string> = { deposit: "예약금", balance: "잔금", full: "여행 요금", refund: "환불" };

export default async function BookingPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ new?: string; paid?: string }> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const full = await viewerBooking(code);
  if (!full) notFound();
  const b = bookingView(full);
  const status = b.status as BookingStatus;
  const stepIdx = STEPS.findIndex((s) => s.key.includes(status));
  const toss = tossEnabled();
  const hasReview = !!(await db.review.findUnique({ where: { booking_id: full.id } }));
  const refunds = full.payments.filter((p) => p.kind === "refund" && p.status === "approved");

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {sp.new && (
        <div className="mb-5 rounded-xl bg-emerald-50 px-4 py-3 text-emerald-800" role="status">
          예약이 접수됐어요. 예약번호 <b>{b.code}</b>를 꼭 적어 두세요.
        </div>
      )}
      <p className="text-sm text-slate-500">예약번호 <span className="font-semibold tabular-nums text-ink">{b.code}</span></p>
      <h1 className="mt-1 text-2xl font-bold">{b.product.name}</h1>
      <p className="mt-1 text-slate-600">{dateKo(b.departure.depart_date, true)} 출발 → {dateKo(b.departure.return_date)} 도착</p>

      {stepIdx >= 0 ? (
        <ol className="mt-6 grid grid-cols-4 gap-1 text-center text-xs sm:text-sm" aria-label="예약 진행">
          {STEPS.map((s, i) => (
            <li key={s.label} aria-current={i === stepIdx ? "step" : undefined} className={`rounded-md py-2 font-semibold ${i < stepIdx ? "bg-sea-100 text-sea-800" : i === stepIdx ? "bg-sea-700 text-white" : "bg-slate-100 text-slate-400"}`}>
              {s.label}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-6 rounded-lg bg-slate-100 px-4 py-3 font-semibold text-slate-700">{BOOKING_STATUS_KO[status]}</p>
      )}

      {/* 지금 할 일 */}
      <section className="mt-6 rounded-2xl border border-slate-200 p-5">
        {status === "pending_deposit" && (
          <>
            <h2 className="font-bold">예약금을 결제해 주세요</h2>
            <p className="mt-1 text-sm text-slate-600"><b>{dateTimeKo(b.pay_deadline)}</b>까지 결제하지 않으면 예약이 자동으로 취소돼요.</p>
            <div className="mt-4"><PayButton code={b.code} kind="deposit" amount={b.deposit_amount} toss={toss} /></div>
          </>
        )}
        {status === "pending_full" && (
          <>
            <h2 className="font-bold">여행 요금을 결제해 주세요</h2>
            <p className="mt-1 text-sm text-slate-600">출발이 가까워 전액을 한 번에 결제해요. <b>{dateTimeKo(b.pay_deadline)}</b>까지예요.</p>
            <div className="mt-4"><PayButton code={b.code} kind="full" amount={b.total_amount} toss={toss} /></div>
          </>
        )}
        {status === "deposit_paid" && (
          <>
            <h2 className="font-bold">잔금 {won(b.balance)}이 남았어요</h2>
            <p className="mt-1 text-sm text-slate-600">{b.balance_deadline ? <><b>{dateTimeKo(b.balance_deadline)}</b>까지 결제해 주세요.</> : "출발 7일 전까지 결제해 주세요."}</p>
            <div className="mt-4"><PayButton code={b.code} kind="balance" amount={b.balance} toss={toss} /></div>
          </>
        )}
        {status === "fully_paid" && <p className="font-semibold text-sea-800">결제가 모두 끝났어요. 출발 3일 전쯤 최종 일정표를 보내 드려요.</p>}
        {status === "cancel_requested" && (
          <p className="text-slate-700">취소 신청을 받았어요. 담당자가 확인한 뒤 예상 환불액 <b>{won(b.cancellation?.refund ?? 0)}</b>을 돌려드려요.</p>
        )}
        {status === "cancelled" && (
          <p className="text-slate-700">
            취소된 예약이에요.{b.cancellation?.reason?.startsWith("여행사 사정") ? " 여행사 사정으로 출발이 취소돼 낸 금액을 모두 돌려드렸어요." : ""}
            {refunds.length > 0 && ` 환불 ${won(refunds.reduce((s, r) => s + r.amount, 0))}`}
          </p>
        )}
        {status === "expired" && <p className="text-slate-700">결제 기한이 지나 자동으로 취소된 예약이에요. 같은 상품을 다시 예약할 수 있어요.</p>}
        {status === "completed" &&
          (b.is_guest ? (
            <p>여행은 어떠셨나요? 후기는 회원만 남길 수 있어요.</p>
          ) : hasReview ? (
            <p className="font-semibold text-sea-800">후기를 남겨 주셔서 고마워요.</p>
          ) : (
            <>
              <h2 className="mb-3 font-bold">여행은 어떠셨나요?</h2>
              <ReviewForm code={b.code} />
            </>
          ))}
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-bold">요금</h2>
        <dl className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
          <Row label="인원" value={`성인 ${b.pax.adults}${b.pax.children ? ` · 아동 ${b.pax.children}` : ""}${b.pax.infants ? ` · 유아 ${b.pax.infants}` : ""}${b.pax.single_rooms ? ` · 싱글룸 ${b.pax.single_rooms}` : ""}`} />
          <Row label="여행 요금 합계" value={won(b.total_amount)} strong />
          <Row label="낸 금액" value={won(b.paid_amount)} />
          {b.balance > 0 && !["cancelled", "expired", "cancel_requested"].includes(status) && <Row label="남은 금액" value={won(b.balance)} />}
        </dl>
        {full.payments.some((p) => p.status === "approved") && (
          <ul className="mt-3 space-y-1 text-sm text-slate-600">
            {full.payments.filter((p) => p.status === "approved").map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>{PAY_KO[p.kind]} · {p.method === "toss" ? "카드(토스 테스트)" : "모의 결제"} · {p.approved_at ? dateTimeKo(p.approved_at.toISOString()) : ""}</span>
                <span className={`tabular-nums ${p.kind === "refund" ? "text-rose-600" : ""}`}>{p.kind === "refund" ? "−" : ""}{won(p.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-bold">여행자</h2>
        <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
          {b.travelers.map((t, i) => (
            <li key={i} className="flex flex-wrap justify-between gap-2 px-4 py-2.5">
              <span className="font-medium">{t.name_ko} <span className="text-slate-500">{t.name_en}</span></span>
              <span className="text-slate-500">{t.type === "adult" ? "성인" : t.type === "child" ? "아동" : "유아"} · {t.gender === "F" ? "여" : "남"} · {t.birth_date}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-sm text-slate-500">예약자 {b.contact.name} · {b.contact.phone} · {b.contact.email}</p>
      </section>

      {["pending_deposit", "pending_full", "deposit_paid", "fully_paid"].includes(status) && (
        <section className="mt-8 border-t border-slate-200 pt-6">
          <CancelPanel code={b.code} paidAlready={b.paid_amount > 0} />
        </section>
      )}

      <p className="mt-8 text-sm text-slate-500">
        궁금한 점은 <Link href={`/support/inquiry?booking=${b.code}`} className="underline">1:1 문의</Link>로 남겨 주세요.{" "}
        <Link href={`/tours/${b.product.code}`} className="underline">상품 다시 보기</Link>
      </p>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between px-4 py-2.5">
      <dt className="text-slate-600">{label}</dt>
      <dd className={strong ? "price" : "font-medium tabular-nums"}>{value}</dd>
    </div>
  );
}
