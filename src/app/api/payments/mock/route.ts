import { NextResponse } from "next/server";
import { z } from "zod";
import { bookingForCustomer } from "@/server/access";
import { readJson, route } from "@/server/http";
import { mockPay } from "@/server/payments";

const body = z.object({ code: z.string().min(1), kind: z.enum(["deposit", "balance", "full"]) });

/** 모의 결제 (토스 키가 없을 때만). */
export const POST = route(async (req) => {
  const { code, kind } = await readJson(req, body);
  const { booking } = await bookingForCustomer(req, code);
  const b = await mockPay(booking.code, kind);
  return NextResponse.json({ code: b.code, status: b.status });
});
