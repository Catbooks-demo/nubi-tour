import { NextResponse } from "next/server";
import { z } from "zod";
import { bookingForCustomer } from "@/server/access";
import { getEnv, tossEnabled } from "@/server/env";
import { HttpError, readJson, route } from "@/server/http";
import { preparePayment } from "@/server/payments";

const body = z.object({ code: z.string().min(1), kind: z.enum(["deposit", "balance", "full"]) });

/** 토스 결제 준비. 토스 키가 없으면 400(모의 결제를 쓰라는 뜻). */
export const POST = route(async (req) => {
  const { code, kind } = await readJson(req, body);
  const { booking } = await bookingForCustomer(req, code);
  if (!tossEnabled()) throw new HttpError(400, "TOSS_DISABLED", "토스 테스트 결제가 꺼져 있어요. 모의 결제를 써 주세요.");
  const p = await preparePayment(booking.code, kind, "toss");
  return NextResponse.json({
    ...p,
    clientKey: getEnv().TOSS_CLIENT_KEY,
    customerName: booking.contact_name,
    customerEmail: booking.contact_email,
  });
});
