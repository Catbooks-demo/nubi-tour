import { NextResponse } from "next/server";
import { authApiKey, canSeePii } from "@/server/apikeys";
import { db } from "@/server/db";
import { HttpError, route } from "@/server/http";
import { BOOKING_REFUNDS, bookingV1 } from "@/server/v1/serialize";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const key = await authApiKey(req, "read");
  const { code } = await params;
  const b = await db.booking.findUnique({
    where: { code: code.toUpperCase() },
    include: { departure: { include: { product: true } }, travelers: { orderBy: { created_at: "asc" } }, payments: BOOKING_REFUNDS },
  });
  if (!b) throw new HttpError(404, "NOT_FOUND", "예약을 찾지 못했어요.");
  return NextResponse.json({ data: bookingV1(b, canSeePii(key)) });
});
