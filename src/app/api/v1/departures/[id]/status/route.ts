import { NextResponse } from "next/server";
import { z } from "zod";
import { authApiKey } from "@/server/apikeys";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { HttpError, readJson, route } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };
// 출발 취소(cancelled)는 환불이 따라와서 직원 화면에서만 한다.
const body = z.object({ status: z.enum(["open", "confirmed", "closed"]) });

export const POST = route<Ctx>(async (req, { params }) => {
  const key = await authApiKey(req, "write");
  const { id } = await params;
  const { status } = await readJson(req, body);
  const d = await db.departure.findUnique({ where: { id } });
  if (!d) throw new HttpError(404, "NOT_FOUND", "출발일을 찾지 못했어요.");
  if (d.status === "cancelled" || d.status === "departed") {
    throw new HttpError(409, "BAD_STATE", "취소됐거나 출발한 출발일은 바꿀 수 없어요.");
  }
  // closed는 직원 마감처럼 유지된다(다시 계산해도 마감). open·confirmed는 마감 표시를 푼다.
  await db.departure.update({ where: { id }, data: { status, manual_closed: status === "closed" } });
  await audit(`api:${key.name}`, "departure.status", id, { from: d.status, to: status });
  return NextResponse.json({ ok: true });
});
