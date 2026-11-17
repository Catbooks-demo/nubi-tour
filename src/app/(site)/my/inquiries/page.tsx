import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { dateTimeKo } from "@/lib/format";
import { currentUser } from "@/server/auth/current";
import { db } from "@/server/db";
import { INQUIRY_CATEGORIES } from "@/server/support";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "1:1 문의 내역" };

export default async function MyInquiries() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/my/inquiries");
  const list = await db.inquiry.findMany({ where: { user_id: user.id }, include: { booking: true }, orderBy: { created_at: "desc" } });
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-end justify-between">
        <h1 className="text-2xl font-bold">1:1 문의 내역</h1>
        <Link href="/support/inquiry" className="btn-primary">문의하기</Link>
      </div>
      {list.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">남긴 문의가 없어요.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {list.map((q) => (
            <li key={q.id} className="rounded-xl border border-slate-200 p-4">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className={`badge ${q.status === "answered" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-100 text-slate-600 ring-slate-200"}`}>{q.status === "answered" ? "답변 완료" : "답변 대기"}</span>
                <span className="text-slate-500">{INQUIRY_CATEGORIES[q.category as keyof typeof INQUIRY_CATEGORIES]} · {dateTimeKo(q.created_at.toISOString())}{q.booking ? ` · ${q.booking.code}` : ""}</span>
              </p>
              <p className="mt-2 font-semibold">{q.title}</p>
              <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{q.body}</p>
              {q.answer && (
                <div className="mt-3 rounded-lg bg-sea-50 p-3 text-sm">
                  <p className="font-semibold text-sea-800">누비투어 답변</p>
                  <p className="mt-1 whitespace-pre-line">{q.answer}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
