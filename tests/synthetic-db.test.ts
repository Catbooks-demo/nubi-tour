import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { runSeed } from "../prisma/seed-lib";
import { cancellationFee } from "@/rules/cancellation";
import { LIVE_STATUSES } from "@/rules/status";
import { addDays, kstDate, kstDateTime } from "@/rules/time";
import { createBooking } from "@/server/bookings";
import { db } from "@/server/db";
import { runBackfill } from "../scripts/synthetic/backfill";
import { runDaily } from "../scripts/synthetic/daily";
import { countSynthetic, deleteSynthetic } from "../scripts/synthetic/engine";
import { SYNTH_DOMAIN, SYNTH_STAFF_EMAIL, WINDOW_DAYS } from "../scripts/synthetic/model";
import { FILES, REPO_ROOT } from "../scripts/synthetic/outdir";
import type { DailyState } from "../scripts/synthetic/state";
import { resetDb } from "./helpers/db";
import { bookingInput } from "./helpers/fixtures";

// 작은 크기(회원 1,500명)로 되채우기 → 매일 모드 한 차례 → 가상 데이터 지우기까지 실제 서버 함수로 돌린다.
const out = mkdtempSync(path.join(tmpdir(), "nubi-synth-"));
const now = new Date();
const today = kstDate(now);
const synth = { contact_email: { endsWith: `@${SYNTH_DOMAIN}` } };
const quiet = () => {};

describe("가상 예약 (DB)", () => {
  beforeAll(async () => {
    await resetDb();
    await runSeed(db, { today });
    await runBackfill({ seed: 11, out, replace: false, force: true, members: 1500, now, log: quiet });
  }, 900_000);

  it("예약이 들어가고, 예약한 날이 기간 시작 전인 예약은 없다", async () => {
    const start = kstDateTime(addDays(today, -WINDOW_DAYS));
    const rows = await db.booking.findMany({ where: synth, select: { created_at: true, code: true } });
    expect(rows.length).toBeGreaterThan(50);
    for (const b of rows) {
      expect(b.created_at.getTime()).toBeGreaterThanOrEqual(start.getTime());
      expect(b.created_at.getTime()).toBeLessThanOrEqual(now.getTime());
      // 예약번호의 날짜 = 예약한 날(한국 시간)
      expect(b.code.slice(2, 8)).toBe(kstDate(b.created_at).replace(/-/g, "").slice(2));
    }
  });

  it("출발일 좌석 수 = 좌석을 잡고 있는 예약의 성인+아동", async () => {
    const deps = await db.departure.findMany({ where: { bookings: { some: {} } }, include: { bookings: true } });
    expect(deps.length).toBeGreaterThan(0);
    for (const d of deps) {
      const held = d.bookings.filter((b) => !b.seats_released_at).reduce((s, b) => s + b.adults + b.children, 0);
      expect(d.seats_taken, d.id).toBe(held);
      expect(d.seats_taken).toBeLessThanOrEqual(d.capacity);
    }
  });

  it("상태·금액이 누비투어 규칙과 맞다", async () => {
    const rows = await db.booking.findMany({ where: synth, include: { departure: true, cancellations: true, payments: true } });
    for (const b of rows) {
      if (b.status === "expired") expect(b.paid_amount).toBe(0);
      if (b.status === "fully_paid" || b.status === "completed") expect(b.paid_amount).toBe(b.total_amount);
      if (b.status === "completed") expect(b.departure.return_date < today).toBe(true);
      if (b.status === "deposit_paid") expect(b.paid_amount).toBe(b.deposit_amount);
      for (const p of b.payments) expect(p.method).toBe("mock");
      for (const c of b.cancellations) {
        if (c.status !== "done") continue;
        if (c.requested_by === "staff") {
          expect(c.fee).toBe(0); // 여행사 사정 출발 취소는 전액 환불
          expect(b.paid_amount).toBe(0);
        } else if (c.paid > 0) {
          expect(c.fee).toBe(cancellationFee(b.total_amount, c.days_before).fee);
          expect(b.paid_amount).toBe(Math.min(c.paid, c.fee));
        }
      }
    }
    expect(rows.some((b) => b.status === "completed" || b.status === "fully_paid" || b.status === "deposit_paid")).toBe(true);
  });

  it("가상 표시: 회원·직원 이메일 도메인, 결제는 모의 결제", async () => {
    expect(await db.user.count({ where: { email: { endsWith: `@${SYNTH_DOMAIN}` } } })).toBe(1500);
    const staff = await db.staff.findUniqueOrThrow({ where: { email: SYNTH_STAFF_EMAIL } });
    expect(staff.active).toBe(false);
    expect(await db.jobRun.count()).toBe(0); // 지난 시각으로 돌린 주기 작업 기록은 남기지 않는다
  });

  it("정답지는 --out에만 쓰고 저장소에는 없다", () => {
    expect(path.relative(REPO_ROOT, out).startsWith("..")).toBe(true);
    const key = JSON.parse(readFileSync(path.join(out, FILES.answerKey), "utf-8"));
    expect(key.start_effect.name).toBe("시작 구간 효과");
    expect(key.start_effect.departures.length).toBeGreaterThan(0);
    expect(key.meta.marker.email_domain).toBe(`@${SYNTH_DOMAIN}`);
    expect(existsSync(path.join(out, FILES.personas))).toBe(true);
    expect(existsSync(path.join(REPO_ROOT, FILES.answerKey))).toBe(false);
  });

  it("매일 모드: 같은 계획을 두 번 넣지 않는다", async () => {
    await runDaily({ out, intervalMin: 10, once: true, maxLateH: 6, log: quiet });
    await runDaily({ out, intervalMin: 10, once: true, maxLateH: 6, log: quiet });
    const guests = await db.booking.findMany({ where: { contact_email: { startsWith: "guest.", endsWith: `@${SYNTH_DOMAIN}` } }, select: { contact_email: true } });
    expect(new Set(guests.map((g) => g.contact_email)).size).toBe(guests.length);
    const state = JSON.parse(readFileSync(path.join(out, FILES.state), "utf-8")) as DailyState;
    expect(state.days[today].next).toBeLessThanOrEqual(state.days[today].total);
    expect(state.inflight).toBeNull();
    expect(existsSync(path.join(out, FILES.lock))).toBe(false);
  }, 300_000);

  it("--replace의 지우기: 가상 데이터만 지우고 좌석을 되돌린다", async () => {
    const dep = await db.departure.findFirstOrThrow({
      where: { depart_date: { gte: addDays(today, 20) }, status: { in: ["open", "confirmed"] }, manual_closed: false },
      orderBy: { depart_date: "asc" },
    });
    const real = await createBooking(bookingInput(dep.id, 2));
    await deleteSynthetic();
    expect(await countSynthetic()).toEqual({ users: 0, bookings: 0, staff: 0 });
    expect(await db.booking.count()).toBe(1);
    expect((await db.booking.findUniqueOrThrow({ where: { id: real.id } })).status).toBe("pending_deposit");
    const deps = await db.departure.findMany({ where: { seats_taken: { gt: 0 } } });
    expect(deps.map((d) => [d.id, d.seats_taken])).toEqual([[dep.id, 2]]);
    expect(await db.inquiry.count()).toBe(0);
    expect(await db.review.count()).toBe(0);
    expect(await db.payment.count()).toBe(0);
    expect(await db.booking.count({ where: { status: { in: LIVE_STATUSES } } })).toBe(1);
  }, 120_000);
});
