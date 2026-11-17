import { noticeCreateAction, noticeToggleAction } from "@/app/admin/actions";
import { Card, Flash, PageTitle, Table, Td } from "@/components/admin/ui";
import { dateTimeKo } from "@/lib/format";
import { db } from "@/server/db";

export const metadata = { title: "공지·FAQ" };

export default async function AdminNotices({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const rows = await db.notice.findMany({ orderBy: [{ kind: "asc" }, { created_at: "desc" }] });
  return (
    <>
      <Flash sp={sp} />
      <PageTitle title="공지·FAQ" />
      <Card>
        <form action={noticeCreateAction} className="grid gap-3 sm:grid-cols-4">
          <div><label className="label" htmlFor="nk">종류</label><select id="nk" name="kind" className="field"><option value="notice">공지</option><option value="faq">FAQ</option></select></div>
          <div><label className="label" htmlFor="nc">FAQ 분류</label><input id="nc" name="category" placeholder="예약·결제·취소…" className="field" /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="nt">제목</label><input id="nt" name="title" required className="field" /></div>
          <div className="sm:col-span-4"><label className="label" htmlFor="nb">내용</label><textarea id="nb" name="body" required rows={3} className="field" /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pinned" className="h-4 w-4 accent-sea-700" />맨 위에 고정</label>
          <div><button className="btn-primary">올리기</button></div>
        </form>
      </Card>
      <div className="mt-5">
        <Table head={["종류", "제목", "고정", "공개", "올린 때", ""]}>
          {rows.map((n) => (
            <tr key={n.id} className={n.published ? "" : "text-slate-400"}>
              <Td>{n.kind === "faq" ? `FAQ · ${n.category ?? "-"}` : "공지"}</Td>
              <td className="px-3 py-2">{n.title}</td>
              <Td>{n.pinned ? "고정" : ""}</Td>
              <Td>{n.published ? "공개" : "내림"}</Td>
              <Td>{dateTimeKo(n.created_at.toISOString())}</Td>
              <Td>
                <form action={noticeToggleAction}><input type="hidden" name="id" value={n.id} /><button className="btn-line px-2 py-1 text-xs">{n.published ? "내리기" : "다시 올리기"}</button></form>
              </Td>
            </tr>
          ))}
        </Table>
      </div>
    </>
  );
}
