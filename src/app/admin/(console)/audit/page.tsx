import { redirect } from "next/navigation";
import { PageTitle, Table, Td } from "@/components/admin/ui";
import { dateTimeKo } from "@/lib/format";
import { currentStaff } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata = { title: "작업 기록" };

export default async function AdminAudit() {
  const me = await currentStaff();
  if (me?.role !== "admin") redirect("/admin");
  const [rows, staff] = await Promise.all([
    db.auditLog.findMany({ orderBy: { created_at: "desc" }, take: 200 }),
    db.staff.findMany({ select: { id: true, name: true } }),
  ]);
  const names = new Map(staff.map((s) => [`staff:${s.id}`, s.name]));
  return (
    <>
      <PageTitle title="작업 기록"><p className="text-sm text-slate-500">직원 화면과 외부 API의 쓰기 작업. 최근 200건.</p></PageTitle>
      <Table head={["시각", "누가", "무엇을", "대상", "내용"]} empty={rows.length === 0}>
        {rows.map((a) => (
          <tr key={a.id}>
            <Td>{dateTimeKo(a.created_at.toISOString())}</Td>
            <Td>{names.get(a.actor) ?? a.actor}</Td>
            <Td>{a.action}</Td>
            <Td className="font-mono text-xs">{a.target}</Td>
            <td className="max-w-md truncate px-3 py-2 text-xs text-slate-500">{a.detail ? JSON.stringify(a.detail) : ""}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
