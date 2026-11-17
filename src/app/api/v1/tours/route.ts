import { NextResponse } from "next/server";
import { authApiKey } from "@/server/apikeys";
import { db } from "@/server/db";
import { route } from "@/server/http";
import { pageOrder, pageResult, pageWhere, readPage } from "@/server/v1/paginate";
import { tourV1 } from "@/server/v1/serialize";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  await authApiKey(req, "read");
  const p = readPage(req);
  const rows = await db.product.findMany({ where: pageWhere(p), orderBy: pageOrder, take: p.limit, include: { region: true } });
  return NextResponse.json(pageResult(rows, p, tourV1));
});
