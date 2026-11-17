import { NextResponse } from "next/server";
import { z } from "zod";
import { bookingForCustomer } from "@/server/access";
import { db } from "@/server/db";
import { HttpError, readJson, route } from "@/server/http";
import { confirmPayment } from "@/server/payments";

const body = z.object({ orderId: z.string().min(1), paymentKey: z.string().min(1), amount: z.number().int().positive() });

/** 토스 결제 성공 화면이 부르는 승인. */
export const POST = route(async (req) => {
  const p = await readJson(req, body);
  const pay = await db.payment.findUnique({ where: { toss_order_id: p.orderId }, include: { booking: true } });
  if (!pay) throw new HttpError(404, "NOT_FOUND", "결제 정보를 찾지 못했어요.");
  await bookingForCustomer(req, pay.booking.code);
  const b = await confirmPayment(p);
  return NextResponse.json({ code: b.code, status: b.status });
});
