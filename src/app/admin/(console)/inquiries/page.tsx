import Link from "next/link";
import { answerInquiryAction } from "@/app/admin/actions";
import { Flash, PageTitle } from "@/components/admin/ui";
import { dateTimeKo } from "@/lib/format";
import { db } from "@/server/db";
import { INQUIRY_CATEGORIES } from "@/server/support";

export const metadata = { title: "1:1 문의" };

export default async function AdminInquiries({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; all?: string }> }) {
  const sp = await searchParams;
  const rows = await db.inquiry.findMany({
    where: sp.all ? {} : { status: "open" },
    include: { booking: true },
    orderBy: { created_at: sp.all ? "desc" : "asc" },
    take: 100,
  });
  return (
    <>
      <Flash sp={sp} />
      <PageTitle title={sp.all ? "모든 문의" : `답변 대기 ${rows.length}건`}>
        <Link href={sp.all ? "/admin/inquiries" : "/admin/inquiries?all=1"} className="text-sm text-slate-500 underline">{sp.all ? "답변 대기만" : "모두 보기"}</Link>
      </PageTitle>
      {rows.length === 0 && <p className="rounded-xl bg-white p-8 text-center text-sm text-slate-500">답변할 문의가 없어요.</p>}
      <ul className="space-y-3">
        {rows.map((q) => (
          <li key={q.id} id={q.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">
              {INQUIRY_CATEGORIES[q.category as keyof typeof INQUIRY_CATEGORIES]} · {dateTimeKo(q.created_at.toISOString())} · {q.name} ({q.email}){q.user_id ? "" : " · 비회원"}
              {q.booking && <> · <Link href={`/admin/bookings/${q.booking.code}`} className="text-sea-700 underline">{q.booking.code}</Link></>}
            </p>
            <p className="mt-1 font-semibold">{q.title}</p>
            <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{q.body}</p>
            <form action={answerInquiryAction} className="mt-3 space-y-2">
              <input type="hidden" name="id" value={q.id} />
              <input type="hidden" name="back" value={sp.all ? "/admin/inquiries?all=1" : "/admin/inquiries"} />
              <textarea name="answer" rows={3} defaultValue={q.answer ?? ""} className="field" placeholder="손님께 보낼 답변" />
              <div className="flex items-center gap-3">
                <button className="btn-primary py-1.5">{q.answer ? "답변 고치기" : "답변 보내기"}</button>
                {q.answered_at && <span className="text-xs text-slate-500">{dateTimeKo(q.answered_at.toISOString())} 답변 ({q.answered_by})</span>}
              </div>
            </form>
          </li>
        ))}
      </ul>
    </>
  );
}
