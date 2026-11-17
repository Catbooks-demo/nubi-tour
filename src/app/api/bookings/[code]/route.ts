import { NextResponse } from "next/server";
import { bookingForCustomer } from "@/server/access";
import { bookingView } from "@/server/bookings";
import { route } from "@/server/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const { code } = await params;
  const { booking } = await bookingForCustomer(req, code);
  return NextResponse.json({ booking: bookingView(booking) });
});
