import { NextResponse } from "next/server";
import { authApiKey } from "@/server/apikeys";
import { db } from "@/server/db";
import { route } from "@/server/http";
import { pageOrder, pageResult, pageWhere, readPage } from "@/server/v1/paginate";
import { departureV1 } from "@/server/v1/serialize";

export const dynamic = "force-dynamic";

/** 출발일 목록. `?product_code=`, `?from=YYYY-MM-DD`로 좁힐 수 있다. */
export const GET = route(async (req) => {
  await authApiKey(req, "read");
  const p = readPage(req);
  const u = new URL(req.url);
  const code = u.searchParams.get("product_code");
  const from = u.searchParams.get("from");
  const rows = await db.departure.findMany({
    where: { ...pageWhere(p), ...(code ? { product: { code } } : {}), ...(from ? { depart_date: { gte: from } } : {}) },
    orderBy: pageOrder,
    take: p.limit,
    include: { product: true },
  });
  return NextResponse.json(pageResult(rows, p, departureV1));
});
