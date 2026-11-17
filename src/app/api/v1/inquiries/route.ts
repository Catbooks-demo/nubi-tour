import { NextResponse } from "next/server";
import { authApiKey, canSeePii } from "@/server/apikeys";
import { db } from "@/server/db";
import { route } from "@/server/http";
import { pageOrder, pageResult, pageWhere, readPage } from "@/server/v1/paginate";
import { inquiryV1 } from "@/server/v1/serialize";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const key = await authApiKey(req, "read");
  const p = readPage(req);
  const status = new URL(req.url).searchParams.get("status");
  const rows = await db.inquiry.findMany({
    where: { ...pageWhere(p), ...(status ? { status } : {}) },
    orderBy: pageOrder,
    take: p.limit,
    include: { booking: true },
  });
  const pii = canSeePii(key);
  return NextResponse.json(pageResult(rows, p, (q) => inquiryV1(q, pii)));
});
