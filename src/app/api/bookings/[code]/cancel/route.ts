import { NextResponse } from "next/server";
import { z } from "zod";
import { bookingForCustomer } from "@/server/access";
import { bookingView, getBookingFull, previewCancel, requestCancel } from "@/server/bookings";
import { readJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

/** 지금 취소하면 수수료·환불액이 얼마인지 미리 보기. */
export const GET = route<Ctx>(async (req, { params }) => {
  const { code } = await params;
  const { booking } = await bookingForCustomer(req, code);
  return NextResponse.json({ preview: await previewCancel(booking.code) });
});

const body = z.object({ reason: z.string().trim().min(1, "취소 사유를 넣어 주세요.").max(500) });

export const POST = route<Ctx>(async (req, { params }) => {
  const { code } = await params;
  const { booking, actor } = await bookingForCustomer(req, code);
  const { reason } = await readJson(req, body);
  await requestCancel(booking.code, actor, reason);
  return NextResponse.json({ booking: bookingView((await getBookingFull(booking.code))!) });
});
