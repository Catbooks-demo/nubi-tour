import Link from "next/link";
import { notFound } from "next/navigation";
import { approveCancelAction, memoAction, rejectCancelAction, retryRefundAction, staffCancelAction } from "@/app/admin/actions";
import { Card, Flash, PageTitle, Table, Td } from "@/components/admin/ui";
import { dateKo, dateTimeKo, won } from "@/lib/format";
import { BOOKING_STATUS_KO, type BookingStatus } from "@/rules/status";
import { calcCancel, getBookingFull } from "@/server/bookings";
import { db } from "@/server/db";

export const metadata = { title: "예약 상세" };

const KIND = { deposit: "예약금", balance: "잔금", full: "전액", refund: "환불" } as Record<string, string>;

export default async function AdminBooking({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const b = await getBookingFull(code);
  if (!b) notFound();
  const status = b.status as BookingStatus;
  const pending = b.cancellations.find((c) => c.status === "requested");
  const now = calcCancel(b.total_amount, b.paid_amount, b.departure.depart_date, new Date());
  const messages = await db.message.findMany({ where: { booking_id: b.id }, orderBy: { created_at: "desc" } });
  const done = b.cancellations.find((c) => c.status === "done");
  const refundLeft = status === "cancelled" && done ? b.paid_amount - done.fee : 0;

  return (
    <>
      <Flash sp={sp} />
      <PageTitle title={`${b.code} · ${BOOKING_STATUS_KO[status]}`}>
        <Link href={`/admin/tours/${b.departure.product.code}`} className="text-sm text-sea-700 underline">{b.departure.product.name}</Link>
      </PageTitle>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <Item k="출발" v={`${dateKo(b.departure.depart_date, true)} (${b.departure.status})`} />
            <Item k="예약자" v={`${b.contact_name}${b.user_id ? "" : " (비회원)"}`} />
            <Item k="연락처" v={`${b.contact_phone} · ${b.contact_email}`} />
            <Item k="인원" v={`성인 ${b.adults} · 아동 ${b.children} · 유아 ${b.infants} · 싱글 ${b.single_rooms}`} />
            <Item k="총액" v={won(b.total_amount)} />
            <Item k="낸 금액" v={won(b.paid_amount)} />
            <Item k="결제 기한" v={dateTimeKo(b.pay_deadline.toISOString())} />
            <Item k="잔금 기한" v={b.balance_deadline ? dateTimeKo(b.balance_deadline.toISOString()) : "-"} />
            <Item k="예약 시각" v={dateTimeKo(b.created_at.toISOString())} />
          </dl>
          <h3 className="mt-5 font-semibold">여행자</h3>
          <ul className="mt-1 text-sm">
            {b.travelers.map((t) => (
              <li key={t.id}>{t.name_ko} / {t.name_en} · {t.type} · {t.gender} · {t.birth_date}{t.passport_last4 ? ` · 여권 끝 ${t.passport_last4}` : ""}</li>
            ))}
          </ul>
        </Card>

        <Card>
          <h3 className="font-semibold">내부 메모</h3>
          <form action={memoAction} className="mt-2 space-y-2">
            <input type="hidden" name="code" value={b.code} />
            <textarea name="memo" rows={4} defaultValue={b.staff_memo ?? ""} className="field" placeholder="손님에게 보이지 않아요" />
            <button className="btn-line py-1.5">메모 저장</button>
          </form>
        </Card>
      </div>

      {pending && (
        <Card className="mt-4 border-dusk-400">
          <h2 className="font-bold">취소 요청 처리</h2>
          <p className="mt-1 text-sm text-slate-600">
            {dateTimeKo(pending.created_at.toISOString())} 요청 ({pending.requested_by}) · 사유: {pending.reason} · 요청 시각 기준 출발 {pending.days_before}일 전, 수수료 {Math.round(pending.fee_rate * 100)}% = {won(pending.fee)}, 환불 예정 {won(pending.refund)}
          </p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <form action={approveCancelAction} className="space-y-2 rounded-lg bg-slate-50 p-3">
              <input type="hidden" name="code" value={b.code} />
              <label className="label" htmlFor="fee">수수료 (바꾸면 사유 필수)</label>
              <input id="fee" name="fee" defaultValue={pending.fee} inputMode="numeric" className="field" />
              <input name="reason" placeholder="수수료를 바꾼 사유" className="field" />
              <button className="btn-primary">승인하고 환불</button>
            </form>
            <form action={rejectCancelAction} className="space-y-2 rounded-lg bg-slate-50 p-3">
              <input type="hidden" name="code" value={b.code} />
              <label className="label" htmlFor="rj">거절 사유 (손님께 안내돼요)</label>
              <input id="rj" name="reason" required className="field" />
              <button className="btn-line">거절</button>
            </form>
          </div>
        </Card>
      )}

      {["pending_deposit", "pending_full", "deposit_paid", "fully_paid"].includes(status) && (
        <Card className="mt-4">
          <h2 className="font-bold">전화로 받은 취소 접수</h2>
          <p className="mt-1 text-sm text-slate-600">지금 취소하면 출발 {now.daysBefore}일 전, 수수료 {won(now.fee)}, 환불 {won(now.refund)}이에요.</p>
          <form action={staffCancelAction} className="mt-2 flex flex-wrap gap-2">
            <input type="hidden" name="code" value={b.code} />
            <input name="reason" required placeholder="손님이 말한 취소 사유" className="field max-w-md" />
            <button className="btn-line">취소 접수</button>
          </form>
        </Card>
      )}

      {refundLeft > 0 && (
        <Card className="mt-4 border-rose-300">
          <h2 className="font-bold text-rose-700">환불이 덜 됐어요 ({won(refundLeft)})</h2>
          <form action={retryRefundAction} className="mt-2"><input type="hidden" name="code" value={b.code} /><button className="btn-primary">환불 다시 시도</button></form>
        </Card>
      )}

      <h2 className="mb-2 mt-6 font-bold">결제·환불</h2>
      <Table head={["종류", "수단", "금액", "상태", "시각", "주문번호"]} empty={b.payments.length === 0}>
        {b.payments.map((p) => (
          <tr key={p.id}>
            <Td>{KIND[p.kind]}</Td><Td>{p.method}</Td><Td className="tabular-nums">{won(p.amount)}</Td>
            <Td>{p.status}{p.failure_reason ? ` (${p.failure_reason})` : ""}</Td>
            <Td>{dateTimeKo((p.approved_at ?? p.created_at).toISOString())}</Td><Td className="text-xs text-slate-500">{p.toss_order_id ?? "-"}</Td>
          </tr>
        ))}
      </Table>

      <h2 className="mb-2 mt-6 font-bold">보낸 안내</h2>
      <Table head={["시각", "종류", "받는 곳", "내용"]} empty={messages.length === 0}>
        {messages.map((m) => (
          <tr key={m.id}><Td>{dateTimeKo(m.created_at.toISOString())}</Td><Td>{m.kind}</Td><Td>{m.to}</Td><td className="px-3 py-2 text-slate-600">{m.body}</td></tr>
        ))}
      </Table>
    </>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
