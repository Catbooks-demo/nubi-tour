import type { Metadata } from "next";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "자주 묻는 질문" };

export default async function FaqPage() {
  const list = await db.notice.findMany({ where: { kind: "faq", published: true }, orderBy: { created_at: "asc" } });
  const groups = [...new Set(list.map((f) => f.category ?? "기타"))];
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold">자주 묻는 질문</h1>
      {groups.map((g) => (
        <section key={g} className="mt-8">
          <h2 className="text-lg font-bold text-sea-800">{g}</h2>
          <ul className="mt-2 divide-y divide-slate-200 border-y border-slate-200">
            {list.filter((f) => (f.category ?? "기타") === g).map((f) => (
              <li key={f.id}>
                <details className="py-3">
                  <summary className="cursor-pointer font-medium">{f.title}</summary>
                  <p className="mt-2 text-sm text-slate-700">{f.body}</p>
                </details>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
