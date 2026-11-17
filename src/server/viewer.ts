import { cookies, headers } from "next/headers";
import { bookingForCustomer } from "./access";
import { HttpError } from "./http";

/** 서버 컴포넌트에서: 지금 손님(회원·비회원 조회 쿠키)이 볼 수 있는 예약. 없으면 null. */
export async function viewerBooking(code: string) {
  const jar = await cookies();
  const h = await headers();
  const req = new Request("http://local/", {
    headers: { cookie: jar.toString(), "x-forwarded-for": h.get("x-forwarded-for") ?? "" },
  });
  try {
    return (await bookingForCustomer(req, code)).booking;
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
}
