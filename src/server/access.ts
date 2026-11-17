import { userFromRequest } from "./auth/session";
import { type Actor, type BookingFull, getBookingFull } from "./bookings";
import { guestCodeFromRequest } from "./guest";
import { HttpError } from "./http";

/** 손님이 이 예약을 볼 수 있는지 확인하고 예약과 행위자를 돌려준다. 남의 예약은 404로 숨긴다. */
export async function bookingForCustomer(req: Request, code: string): Promise<{ booking: BookingFull; actor: Actor }> {
  const booking = await getBookingFull(code.toUpperCase());
  if (booking) {
    const user = await userFromRequest(req);
    if (user && booking.user_id === user.id) return { booking, actor: { kind: "customer", id: user.id } };
    if (!booking.user_id && guestCodeFromRequest(req) === booking.code) return { booking, actor: { kind: "guest" } };
  }
  throw new HttpError(404, "NOT_FOUND", "예약을 찾지 못했어요.");
}
