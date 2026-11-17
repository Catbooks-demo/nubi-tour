import Link from "next/link";
import { PageTitle, Table, Td } from "@/components/admin/ui";
import { nightsDays, won } from "@/lib/format";
import { kstDate } from "@/rules/time";
import { db } from "@/server/db";

export const metadata = { title: "상품·출발일" };

export default async function AdminTours() {
  const today = kstDate(new Date());
  const products = await db.product.findMany({
    include: { region: true, departures: { where: { depart_date: { gte: today } } } },
    orderBy: { sort_rank: "asc" },
  });
  return (
    <>
      <PageTitle title={`상품 ${products.length}개`} />
      <Table head={["코드", "상품", "지역", "일정", "기준가", "앞으로 출발일", "확정", "좌석(예약/정원)", "판매"]}>
        {products.map((p) => {
          const taken = p.departures.reduce((s, d) => s + d.seats_taken, 0);
          const cap = p.departures.reduce((s, d) => s + d.capacity, 0);
          return (
            <tr key={p.id} className="hover:bg-slate-50">
              <Td><Link href={`/admin/tours/${p.code}`} className="text-sea-700 underline">{p.code}</Link></Td>
              <Td className="max-w-72 truncate">{p.name}</Td>
              <Td>{p.region.name}</Td>
              <Td>{nightsDays(p.nights, p.days)}</Td>
              <Td className="tabular-nums">{won(p.base_price)}</Td>
              <Td>{p.departures.length}개</Td>
              <Td>{p.departures.filter((d) => d.status === "confirmed").length}개</Td>
              <Td className="tabular-nums">{taken}/{cap}</Td>
              <Td>{p.on_sale ? "판매 중" : <span className="text-rose-600">중지</span>}</Td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
