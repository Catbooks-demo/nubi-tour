import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { apiKeyIssueAction, apiKeyRevokeAction } from "@/app/admin/actions";
import { Card, Flash, PageTitle, Table, Td } from "@/components/admin/ui";
import { dateTimeKo } from "@/lib/format";
import { NEW_KEY_COOKIE, SCOPES, SCOPE_KO } from "@/server/apikeys";
import { currentStaff } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata = { title: "API 키" };

export default async function AdminApiKeys({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const me = await currentStaff();
  if (me?.role !== "admin") redirect("/admin");
  const sp = await searchParams;
  const fresh = (await cookies()).get(NEW_KEY_COOKIE)?.value;
  const rows = await db.apiKey.findMany({ orderBy: { created_at: "desc" } });
  return (
    <>
      <Flash sp={sp} />
      <PageTitle title="API 키"><Link href="/api/v1/openapi.json" className="text-sm text-sea-700 underline">API 설명 (OpenAPI)</Link></PageTitle>
      {fresh && (
        <Card className="mb-5 border-dusk-400">
          <p className="font-bold">새 키 — 지금 한 번만 보여요. 안전한 곳에 복사해 두세요.</p>
          <code className="mt-2 block break-all rounded bg-slate-900 p-3 text-sm text-emerald-300">{fresh}</code>
        </Card>
      )}
      <Table head={["이름", "앞부분", "권한", "마지막 사용", "만든 때", "상태", ""]} empty={rows.length === 0}>
        {rows.map((k) => (
          <tr key={k.id} className={k.revoked_at ? "text-slate-400" : ""}>
            <Td>{k.name}</Td><Td className="font-mono text-xs">{k.prefix}…</Td><Td>{k.scopes.join(", ")}</Td>
            <Td>{k.last_used_at ? dateTimeKo(k.last_used_at.toISOString()) : "-"}</Td>
            <Td>{dateTimeKo(k.created_at.toISOString())}</Td>
            <Td>{k.revoked_at ? "폐기됨" : "사용 중"}</Td>
            <Td>{!k.revoked_at && <form action={apiKeyRevokeAction}><input type="hidden" name="id" value={k.id} /><button className="btn-line px-2 py-1 text-xs text-rose-600">폐기</button></form>}</Td>
          </tr>
        ))}
      </Table>
      <Card className="mt-5">
        <h2 className="font-bold">키 만들기</h2>
        <p className="mt-1 text-sm text-slate-600">정산·ERP 같은 외부 시스템이 예약 데이터를 읽을 때 써요. 필요한 권한만 주세요.</p>
        <form action={apiKeyIssueAction} className="mt-3 space-y-3">
          <input name="name" required placeholder="어디에 쓰는 키인가요 (예: 정산 시스템)" className="field max-w-md" />
          <div className="space-y-1 text-sm">
            {SCOPES.map((s) => (
              <label key={s} className="flex items-center gap-2"><input type="checkbox" name="scopes" value={s} defaultChecked={s === "read"} className="h-4 w-4 accent-sea-700" />{s} — {SCOPE_KO[s]}</label>
            ))}
          </div>
          <button className="btn-primary">키 만들기</button>
        </form>
      </Card>
    </>
  );
}
