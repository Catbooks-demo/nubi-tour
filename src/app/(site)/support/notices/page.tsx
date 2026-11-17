import type { Metadata } from "next";
import { dateKo } from "@/lib/format";
import { kstDate } from "@/rules/time";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "공지사항" };

export default async function NoticesPage() {
  const list = await db.notice.findMany({ where: { kind: "notice", published: true }, orderBy: [{ pinned: "desc" }, { created_at: "desc" }] });
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold">공지사항</h1>
      <ul className="mt-6 divide-y divide-slate-200 border-y border-slate-200">
        {list.map((n) => (
          <li key={n.id} id={n.id} className="py-4">
            <p className="flex items-center gap-2 font-semibold">
              {n.pinned && <span className="badge bg-sea-50 text-sea-700 ring-sea-200">중요</span>}
              {n.title}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">{dateKo(kstDate(n.created_at), true)}</p>
            <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{n.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
