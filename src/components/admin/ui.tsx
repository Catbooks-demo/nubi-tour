import Link from "next/link";

/** 처리 결과 알림 (?ok= / ?err=). */
export function Flash({ sp }: { sp: { ok?: string; err?: string } }) {
  if (sp.err) return <p className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">{sp.err}</p>;
  if (sp.ok) return <p className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">{sp.ok}</p>;
  return null;
}

export function PageTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <h1 className="text-xl font-bold">{title}</h1>
      {children}
    </div>
  );
}

export function Table({ head, children, empty }: { head: string[]; children: React.ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>{head.map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
      {empty && <p className="p-6 text-center text-sm text-slate-500">없어요.</p>}
    </div>
  );
}

export const Td = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <td className={`whitespace-nowrap px-3 py-2 ${className}`}>{children}</td>
);

export function Pager({ page, pages, href }: { page: number; pages: number; href: (p: number) => string }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="페이지" className="mt-4 flex gap-1">
      {page > 1 && <Link href={href(page - 1)} className="rounded px-3 py-1 text-sm hover:bg-slate-200">이전</Link>}
      <span className="px-3 py-1 text-sm text-slate-500">{page} / {pages}</span>
      {page < pages && <Link href={href(page + 1)} className="rounded px-3 py-1 text-sm hover:bg-slate-200">다음</Link>}
    </nav>
  );
}

export const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <section className={`rounded-xl border border-slate-200 bg-white p-4 ${className}`}>{children}</section>
);
