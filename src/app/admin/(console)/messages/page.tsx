import { PageTitle, Table, Td } from "@/components/admin/ui";
import { dateTimeKo } from "@/lib/format";
import { db } from "@/server/db";

export const metadata = { title: "보낸 편지함" };

export default async function AdminMessages() {
  const rows = await db.message.findMany({ orderBy: { created_at: "desc" }, take: 200 });
  return (
    <>
      <PageTitle title="보낸 편지함"><p className="text-sm text-slate-500">문자·이메일은 실제로 보내지 않고 여기에만 남겨요. 최근 200건.</p></PageTitle>
      <Table head={["시각", "채널", "종류", "받는 곳", "내용"]} empty={rows.length === 0}>
        {rows.map((m) => (
          <tr key={m.id}>
            <Td>{dateTimeKo(m.created_at.toISOString())}</Td>
            <Td>{m.channel === "sms" ? "문자" : "이메일"}</Td>
            <Td>{m.kind}</Td>
            <Td>{m.to}</Td>
            <td className="px-3 py-2 text-slate-700">{m.channel === "email" ? <><b>{m.subject}</b><br /></> : null}{m.body}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
