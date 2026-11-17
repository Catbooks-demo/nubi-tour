import { kstDate } from "@/rules/time";
import type { Tx } from "./tx";

/** 예약번호: NB + 한국 날짜 yyMMdd + 그날 일련 4자리 (NB2611170001). 동시에 불러도 겹치지 않는다. */
export async function nextBookingCode(tx: Tx, now: Date): Promise<string> {
  const day = kstDate(now).replace(/-/g, "").slice(2);
  const rows = await tx.$queryRaw<{ last: number }[]>`
    INSERT INTO booking_counters (day, last) VALUES (${day}, 1)
    ON CONFLICT (day) DO UPDATE SET last = booking_counters.last + 1
    RETURNING last`;
  return `NB${day}${String(rows[0].last).padStart(4, "0")}`;
}
