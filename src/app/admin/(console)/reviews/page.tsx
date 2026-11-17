import { toggleReviewAction } from "@/app/admin/actions";
import { Flash, PageTitle, Table, Td } from "@/components/admin/ui";
import { dateTimeKo } from "@/lib/format";
import { db } from "@/server/db";

export const metadata = { title: "후기" };

export default async function AdminReviews({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const rows = await db.review.findMany({ include: { user: true, booking: { include: { departure: { include: { product: true } } } } }, orderBy: { created_at: "desc" }, take: 100 });
  return (
    <>
      <Flash sp={sp} />
      <PageTitle title={`후기 ${rows.length}개`} />
      <Table head={["작성", "상품", "별점", "내용", "작성자", "공개"]} empty={rows.length === 0}>
        {rows.map((r) => (
          <tr key={r.id} className={r.hidden ? "bg-slate-50 text-slate-400" : ""}>
            <Td>{dateTimeKo(r.created_at.toISOString())}</Td>
            <Td className="max-w-48 truncate">{r.booking.departure.product.name}</Td>
            <Td>{"★".repeat(r.rating)}</Td>
            <td className="max-w-md px-3 py-2">{r.body}</td>
            <Td>{r.user.name}</Td>
            <Td>
              <form action={toggleReviewAction}>
                <input type="hidden" name="id" value={r.id} />
                <button className="btn-line px-2 py-1 text-xs">{r.hidden ? "다시 보이기" : "숨기기"}</button>
              </form>
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
