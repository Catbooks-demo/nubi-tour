import { redirect } from "next/navigation";
import { staffCreateAction, staffToggleAction } from "@/app/admin/actions";
import { Card, Flash, PageTitle, Table, Td } from "@/components/admin/ui";
import { dateTimeKo } from "@/lib/format";
import { currentStaff } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata = { title: "직원" };

export default async function AdminStaff({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const me = await currentStaff();
  if (me?.role !== "admin") redirect("/admin");
  const sp = await searchParams;
  const rows = await db.staff.findMany({ orderBy: { created_at: "asc" } });
  return (
    <>
      <Flash sp={sp} />
      <PageTitle title="직원" />
      <Table head={["이름", "이메일", "역할", "상태", "추가한 때", ""]}>
        {rows.map((s) => (
          <tr key={s.id} className={s.active ? "" : "text-slate-400"}>
            <Td>{s.name}</Td><Td>{s.email}</Td><Td>{s.role === "admin" ? "관리자" : "상담원"}</Td><Td>{s.active ? "사용 중" : "꺼짐"}</Td>
            <Td>{dateTimeKo(s.created_at.toISOString())}</Td>
            <Td>{s.id !== me.id && <form action={staffToggleAction}><input type="hidden" name="id" value={s.id} /><button className="btn-line px-2 py-1 text-xs">{s.active ? "끄기" : "켜기"}</button></form>}</Td>
          </tr>
        ))}
      </Table>
      <Card className="mt-5">
        <h2 className="font-bold">직원 추가</h2>
        <form action={staffCreateAction} className="mt-3 grid gap-3 sm:grid-cols-5">
          <input name="name" placeholder="이름" className="field" />
          <input name="email" type="email" required placeholder="이메일" className="field" />
          <input name="password" type="password" required minLength={10} placeholder="첫 비밀번호 (10자 이상)" autoComplete="new-password" className="field" />
          <select name="role" className="field"><option value="agent">상담원</option><option value="admin">관리자</option></select>
          <button className="btn-primary">추가</button>
        </form>
      </Card>
    </>
  );
}
