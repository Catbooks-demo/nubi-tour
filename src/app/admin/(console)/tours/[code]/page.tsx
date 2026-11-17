import Link from "next/link";
import { notFound } from "next/navigation";
import { addDepartureAction, cancelDepartureAction, departureStatusAction, productEditAction } from "@/app/admin/actions";
import { Card, Flash, PageTitle, Table, Td } from "@/components/admin/ui";
import { DEPARTURE_BADGE, dateShort, won } from "@/lib/format";
import { PAID_STATUSES } from "@/rules/status";
import { kstDate } from "@/rules/time";
import { db } from "@/server/db";

export const metadata = { title: "상품 관리" };

export default async function AdminTour({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ ok?: string; err?: string; past?: string }> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const today = kstDate(new Date());
  const p = await db.product.findUnique({
    where: { code },
    include: {
      departures: {
        where: sp.past ? {} : { depart_date: { gte: today } },
        orderBy: { depart_date: "asc" },
        include: { bookings: { where: { status: { in: [...PAID_STATUSES, "pending_deposit", "pending_full", "cancel_requested"] } } } },
      },
    },
  });
  if (!p) notFound();
  const back = `/admin/tours/${p.code}`;

  return (
    <>
      <Flash sp={sp} />
      <PageTitle title={p.name}>
        <Link href={`/tours/${p.code}`} className="text-sm text-sea-700 underline">손님 화면에서 보기</Link>
      </PageTitle>

      <Card>
        <form action={productEditAction} className="grid gap-3 md:grid-cols-[2fr_1fr_auto]">
          <input type="hidden" name="code" value={p.code} />
          <div><label className="label" htmlFor="pn">상품 이름</label><input id="pn" name="name" defaultValue={p.name} className="field" /></div>
          <div><label className="label" htmlFor="bp">기준가 (목록 표시)</label><input id="bp" name="base_price" defaultValue={p.base_price} inputMode="numeric" className="field" /></div>
          <label className="flex items-end gap-2 pb-2.5 text-sm"><input type="checkbox" name="on_sale" defaultChecked={p.on_sale} className="h-4 w-4 accent-sea-700" />판매 중</label>
          <div className="md:col-span-3"><label className="label" htmlFor="ps">요약</label><textarea id="ps" name="summary" rows={2} defaultValue={p.summary} className="field" /></div>
          <div><button className="btn-primary">상품 저장</button></div>
        </form>
      </Card>

      <div className="mb-2 mt-6 flex items-end justify-between">
        <h2 className="font-bold">출발일</h2>
        <Link href={sp.past ? back : `${back}?past=1`} className="text-sm text-slate-500 underline">{sp.past ? "앞으로만 보기" : "지난 출발일도 보기"}</Link>
      </div>
      <Table head={["출발", "상태", "예약 좌석/정원", "결제 좌석/최소", "성인가", "처리"]} empty={p.departures.length === 0}>
        {p.departures.map((d) => {
          const paid = d.bookings.filter((b) => (PAID_STATUSES as string[]).includes(b.status)).reduce((s, b) => s + b.adults + b.children, 0);
          const live = d.status !== "cancelled" && d.status !== "departed";
          return (
            <tr key={d.id}>
              <Td>{dateShort(d.depart_date)}</Td>
              <Td><span className={`badge ${DEPARTURE_BADGE[d.status]?.tone}`}>{DEPARTURE_BADGE[d.status]?.label}</span></Td>
              <Td className="tabular-nums">{d.seats_taken}/{d.capacity}</Td>
              <Td className="tabular-nums">{paid}/{d.min_pax}</Td>
              <Td className="tabular-nums">{won(d.price_adult)}</Td>
              <Td>
                {live && (
                  <div className="flex flex-wrap items-center gap-2">
                    <form action={departureStatusAction}>
                      <input type="hidden" name="id" value={d.id} /><input type="hidden" name="back" value={back} />
                      <input type="hidden" name="status" value={d.status === "closed" ? "open" : "closed"} />
                      <button className="btn-line px-2 py-1 text-xs">{d.status === "closed" ? "다시 열기" : "마감"}</button>
                    </form>
                    <details>
                      <summary className="cursor-pointer text-xs text-rose-600">출발 취소</summary>
                      <form action={cancelDepartureAction} className="mt-1 flex gap-1">
                        <input type="hidden" name="id" value={d.id} /><input type="hidden" name="back" value={back} />
                        <input name="reason" placeholder="최소 출발 인원 미달" className="field w-44 py-1 text-xs" />
                        <button className="btn bg-rose-600 px-2 py-1 text-xs text-white">취소·전액 환불</button>
                      </form>
                    </details>
                  </div>
                )}
              </Td>
            </tr>
          );
        })}
      </Table>

      <Card className="mt-6">
        <h2 className="font-bold">출발일 추가</h2>
        <form action={addDepartureAction} className="mt-3 grid gap-3 sm:grid-cols-6">
          <input type="hidden" name="code" value={p.code} />
          <div><label className="label" htmlFor="dd">출발일</label><input id="dd" name="depart_date" type="date" required className="field" /></div>
          <div><label className="label" htmlFor="pa">성인가</label><input id="pa" name="price_adult" inputMode="numeric" defaultValue={p.base_price} className="field" /></div>
          <div><label className="label" htmlFor="ss">싱글 추가</label><input id="ss" name="single_supplement" inputMode="numeric" defaultValue={p.departures[0]?.single_supplement ?? 0} className="field" /></div>
          <div><label className="label" htmlFor="cp">정원</label><input id="cp" name="capacity" inputMode="numeric" defaultValue={p.departures[0]?.capacity ?? 24} className="field" /></div>
          <div><label className="label" htmlFor="mp">최소 출발</label><input id="mp" name="min_pax" inputMode="numeric" defaultValue={p.departures[0]?.min_pax ?? 6} className="field" /></div>
          <div className="flex items-end"><button className="btn-primary w-full">추가</button></div>
        </form>
        <p className="mt-2 text-xs text-slate-500">아동가는 성인가의 90%, 유아가는 10%로 자동으로 넣어요.</p>
      </Card>
    </>
  );
}
