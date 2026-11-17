import type { Booking } from "@prisma/client";
import type { Tx } from "./tx";

/** 문자 발송 대신 보낸 편지함에 기록한다(실제로 보내지 않음). */
export async function recordMessage(
  tx: Tx,
  booking: Pick<Booking, "id" | "contact_phone" | "code">,
  kind: string,
  subject: string,
  body: string,
): Promise<void> {
  await tx.message.create({
    data: {
      booking_id: booking.id,
      channel: "sms",
      to: booking.contact_phone,
      kind,
      subject,
      body: `[누비투어] ${body} (예약번호 ${booking.code})`,
    },
  });
}

/** 같은 예약에 같은 종류 안내를 이미 보냈는지. */
export async function alreadySent(tx: Tx, bookingId: string, kind: string): Promise<boolean> {
  return (await tx.message.count({ where: { booking_id: bookingId, kind } })) > 0;
}

export const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
