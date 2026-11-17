import { NextResponse } from "next/server";
import { z } from "zod";
import { authApiKey } from "@/server/apikeys";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { HttpError, readJson, route } from "@/server/http";

type Ctx = { params: Promise<{ code: string }> };
const body = z.object({ memo: z.string().max(2000) });

/** 예약 내부 메모 바꾸기 (손님에게 보이지 않음). */
export const POST = route<Ctx>(async (req, { params }) => {
  const key = await authApiKey(req, "write");
  const { code } = await params;
  const { memo } = await readJson(req, body);
  const b = await db.booking.findUnique({ where: { code: code.toUpperCase() } });
  if (!b) throw new HttpError(404, "NOT_FOUND", "예약을 찾지 못했어요.");
  await db.booking.update({ where: { id: b.id }, data: { staff_memo: memo || null } });
  await audit(`api:${key.name}`, "booking.memo", b.code, { memo });
  return NextResponse.json({ ok: true });
});
