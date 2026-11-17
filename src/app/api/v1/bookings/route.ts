import { NextResponse } from "next/server";
import { authApiKey, canSeePii } from "@/server/apikeys";
import { db } from "@/server/db";
import { route } from "@/server/http";
import { pageOrder, pageResult, pageWhere, readPage } from "@/server/v1/paginate";
import { bookingV1 } from "@/server/v1/serialize";

export const dynamic = "force-dynamic";

/** 예약 목록. `?status=`로 좁힐 수 있다. 개인정보는 read_pii 키에만 원문. */
export const GET = route(async (req) => {
  const key = await authApiKey(req, "read");
  const p = readPage(req);
  const status = new URL(req.url).searchParams.get("status");
  const rows = await db.booking.findMany({
    where: { ...pageWhere(p), ...(status ? { status } : {}) },
    orderBy: pageOrder,
    take: p.limit,
    include: { departure: { include: { product: true } }, travelers: { orderBy: { created_at: "asc" } } },
  });
  const pii = canSeePii(key);
  return NextResponse.json(pageResult(rows, p, (b) => bookingV1(b, pii)));
});
