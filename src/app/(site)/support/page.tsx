import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "고객센터" };

export default async function SupportPage() {
  const faqs = await db.notice.findMany({ where: { kind: "faq", published: true }, orderBy: { created_at: "asc" }, take: 4 });
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-bold">고객센터</h1>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Card href="/support/faq" title="자주 묻는 질문" desc="예약·결제·취소·여권" />
        <Card href="/support/inquiry" title="1:1 문의" desc="답변은 영업일 기준 하루 안에 드려요" />
        <Card href="/lookup" title="비회원 예약 조회" desc="예약번호와 조회 비밀번호로" />
      </div>
      <section className="mt-10">
        <h2 className="text-lg font-bold">많이 묻는 질문</h2>
        <ul className="mt-3 divide-y divide-slate-200 border-y border-slate-200">
          {faqs.map((f) => (
            <li key={f.id}>
              <details className="py-3">
                <summary className="cursor-pointer font-medium">{f.title}</summary>
                <p className="mt-2 text-sm text-slate-700">{f.body}</p>
              </details>
            </li>
          ))}
        </ul>
      </section>
      <section className="mt-10 rounded-xl bg-slate-50 p-5 text-sm text-slate-600">
        <h2 className="font-bold text-ink">상담 시간</h2>
        <p className="mt-1">평일 09:00~18:00 (점심 12:00~13:00, 주말·공휴일 휴무). 시연용 사이트라 전화 상담은 운영하지 않아요.</p>
      </section>
    </div>
  );
}

function Card({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link href={href} className="rounded-xl border border-slate-200 p-5 hover:border-sea-300">
      <p className="font-bold">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{desc}</p>
    </Link>
  );
}
