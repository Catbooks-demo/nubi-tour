import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function PayFailPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const canceled = sp.code === "PAY_PROCESS_CANCELED";
  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      <p className="text-lg font-semibold">{canceled ? "결제를 취소했어요" : "결제하지 못했어요"}</p>
      {!canceled && sp.message && <p className="mt-2 text-sm text-slate-600">{sp.message}</p>}
      <p className="mt-2 text-sm text-slate-500">예약은 그대로 남아 있어요. 결제 기한 안에 다시 결제해 주세요.</p>
      <Link href={sp.booking && /^NB\d{10}$/.test(sp.booking) ? `/bookings/${sp.booking}` : "/my"} className="btn-primary mt-6">예약으로 돌아가기</Link>
    </div>
  );
}
