import { NextResponse } from "next/server";
import { z } from "zod";
import { approveCancel, rejectCancel } from "@/server/admin";
import { authApiKey } from "@/server/apikeys";
import { db } from "@/server/db";
import { HttpError, readJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const body = z.object({
  decision: z.enum(["approve", "reject"], { message: "decision은 approve 또는 reject예요." }),
  refund_amount: z.number().int("환불 금액은 원 단위 정수예요.").min(0, "환불 금액은 0원 이상이에요.").optional(),
  reason: z.string().trim().max(500).optional(),
});

/**
 * 취소 요청 결정 (외부 시스템용, write 범위).
 * - approve: 사이트 규칙으로 정한 수수료대로 환불한다. `refund_amount`를 주면 그 금액이 되도록
 *   수수료를 바꾸고, 이때는 `reason`이 필요하다(직원 화면과 같은 규칙).
 * - reject: `reason`이 필요하다. 예약은 취소 요청 전 상태로 돌아간다.
 * - 이미 같은 결정으로 끝난 요청을 다시 보내면 그 결과를 그대로 돌려준다(`replayed: true`, 200).
 *   다른 결정이나 다른 금액이면 409 ALREADY_DECIDED.
 */
export const POST = route<Ctx>(async (req, { params }) => {
  const key = await authApiKey(req, "write");
  const { id } = await params;
  const { decision, refund_amount, reason } = await readJson(req, body);
  const actor = `api:${key.name}`;
  const c = await db.cancellation.findUnique({ where: { id }, include: { booking: true } });
  if (!c) throw new HttpError(404, "NOT_FOUND", "취소 요청을 찾을 수 없어요.");

  if (c.status !== "requested") {
    const same =
      (decision === "approve" && c.status === "done" && (refund_amount === undefined || refund_amount === c.refund)) ||
      (decision === "reject" && c.status === "rejected");
    if (!same) throw new HttpError(409, "ALREADY_DECIDED", "이미 다른 결정으로 처리된 취소 요청이에요.");
    return NextResponse.json(view(c, true));
  }

  if (decision === "approve") {
    let fee: number | undefined;
    if (refund_amount !== undefined) {
      if (refund_amount > c.booking.paid_amount) {
        throw new HttpError(400, "BAD_REFUND", "환불 금액이 받은 금액보다 많아요.");
      }
      fee = c.booking.paid_amount - refund_amount;
    }
    await approveCancel(c.booking.code, actor, { fee, reason: reason || undefined, actor });
  } else {
    await rejectCancel(c.booking.code, actor, reason ?? "", new Date(), actor);
  }
  const after = await db.cancellation.findUniqueOrThrow({ where: { id }, include: { booking: true } });
  return NextResponse.json(view(after, false));
});

function view(c: { id: string; booking: { code: string }; status: string; fee: number; refund: number; decided_at: Date | null }, replayed: boolean) {
  return {
    id: c.id,
    booking_code: c.booking.code,
    status: c.status,
    fee: c.fee,
    refund_amount: c.status === "done" ? c.refund : 0,
    decided_at: c.decided_at ? c.decided_at.toISOString() : null,
    replayed,
  };
}
