import { describe, expect, it } from "vitest";
import { cancellationFee, refundAmount } from "@/rules/cancellation";
import { departureStatus } from "@/rules/departure";
import { ageOn, quote, travelerType, validBirthDate, validatePax } from "@/rules/pricing";
import { paymentPlan } from "@/rules/schedule";
import { canTransition } from "@/rules/status";
import { addDays, daysBefore, kstDate, kstDateTime, kstEndOfDay } from "@/rules/time";

const pax = (adults: number, children = 0, infants = 0, single_rooms = 0) => ({ adults, children, infants, single_rooms });
const dep = { price_adult: 1_000_000, price_child: 900_000, price_infant: 100_000, single_supplement: 200_000, deposit_per_person: 300_000 };

describe("한국 시간", () => {
  it("UTC 15:00이 한국 날짜 경계다", () => {
    expect(kstDate(new Date("2026-11-01T14:59:59Z"))).toBe("2026-11-01");
    expect(kstDate(new Date("2026-11-01T15:00:00Z"))).toBe("2026-11-02");
  });
  it("며칠 전 계산은 한국 날짜 기준", () => {
    expect(daysBefore("2026-12-01", new Date("2026-11-01T14:59:59Z"))).toBe(30);
    expect(daysBefore("2026-12-01", new Date("2026-11-01T15:00:00Z"))).toBe(29);
    expect(daysBefore("2026-12-01", new Date("2026-12-01T03:00:00Z"))).toBe(0);
    expect(daysBefore("2026-12-01", new Date("2026-12-02T03:00:00Z"))).toBe(-1);
  });
  it("addDays는 달·해를 넘긴다", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("kstEndOfDay는 그날 23:59:59 KST", () => {
    expect(kstEndOfDay("2026-12-01").toISOString()).toBe("2026-12-01T14:59:59.000Z");
    expect(kstDateTime("2026-12-01", 9).toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });
});

describe("취소 수수료 (국외여행 표준약관)", () => {
  const cases: [number, number][] = [
    [45, 0], [30, 0], [29, 0.1], [20, 0.1], [19, 0.15], [10, 0.15],
    [9, 0.2], [8, 0.2], [7, 0.3], [1, 0.3], [0, 0.5], [-1, 1],
  ];
  it.each(cases)("%i일 전 → %f", (d, rate) => {
    expect(cancellationFee(1_000_000, d).rate).toBe(rate);
  });
  it("수수료는 원 단위 내림", () => {
    expect(cancellationFee(1_234_567, 25).fee).toBe(123_456);
  });
  it("환불액은 0보다 작아지지 않는다", () => {
    expect(refundAmount(300_000, 500_000)).toBe(0);
    expect(refundAmount(2_000_000, 300_000)).toBe(1_700_000);
  });
});

describe("요금", () => {
  it("성인2·아동1·유아1·싱글1", () => {
    const q = quote(dep, pax(2, 1, 1, 1));
    expect(q.total).toBe(2_000_000 + 900_000 + 100_000 + 200_000);
    expect(q.seats).toBe(3);
    expect(q.lines.map((l) => l.label)).toEqual(["성인", "아동", "유아", "싱글룸 추가"]);
  });
  it("인원 검사", () => {
    expect(validatePax(pax(2))).toBeNull();
    expect(validatePax(pax(0, 1))).not.toBeNull();
    expect(validatePax(pax(1, 0, 2))).not.toBeNull();
    expect(validatePax(pax(5, 5))).not.toBeNull();
    expect(validatePax(pax(1, 0, 0, 2))).not.toBeNull();
    expect(validatePax(pax(1.5))).not.toBeNull();
  });
  it("나이는 출발일 기준 만 나이", () => {
    expect(ageOn("2014-12-02", "2026-12-01")).toBe(11);
    expect(ageOn("2014-12-01", "2026-12-01")).toBe(12);
    expect(travelerType("2014-12-02", "2026-12-01")).toBe("child");
    expect(travelerType("2014-12-01", "2026-12-01")).toBe("adult");
    expect(travelerType("2024-12-02", "2026-12-01")).toBe("infant");
    expect(travelerType("2024-12-01", "2026-12-01")).toBe("child");
  });
  it("생년월일 검사", () => {
    expect(validBirthDate("1990-02-28", "2026-11-17")).toBe(true);
    expect(validBirthDate("1990-02-30", "2026-11-17")).toBe(false);
    expect(validBirthDate("2027-01-01", "2026-11-17")).toBe(false);
    expect(validBirthDate("1990/02/28", "2026-11-17")).toBe(false);
  });
});

describe("결제 계획", () => {
  const at = new Date("2026-11-17T03:00:00Z"); // KST 2026-11-17 12:00
  it("8일 이상 남으면 예약금", () => {
    const p = paymentPlan("2026-11-25", at, 3_000_000, 3, 300_000);
    expect(p.mode).toBe("deposit");
    expect(p.firstAmount).toBe(900_000);
    expect(p.payDeadline.getTime() - at.getTime()).toBe(86_400_000);
    expect(p.balanceDeadline?.toISOString()).toBe(kstEndOfDay("2026-11-18").toISOString());
  });
  it("예약금은 총액을 넘지 않는다", () => {
    expect(paymentPlan("2026-12-25", at, 500_000, 2, 300_000).firstAmount).toBe(500_000);
  });
  it("7일 이내면 전액", () => {
    const p = paymentPlan("2026-11-24", at, 3_000_000, 3, 300_000);
    expect(p.mode).toBe("full");
    expect(p.firstAmount).toBe(3_000_000);
    expect(p.balanceDeadline).toBeNull();
  });
  it("전액 결제 기한은 출발 전날 23:59:59 KST를 넘지 않는다", () => {
    const late = new Date("2026-11-19T14:00:00Z"); // KST 11-19 23:00, 출발 11-22 → 3일 전
    const p = paymentPlan("2026-11-22", late, 1_000_000, 1, 300_000);
    expect(p.mode).toBe("full");
    expect(p.payDeadline.getTime()).toBeLessThanOrEqual(kstEndOfDay("2026-11-21").getTime());
  });
  it("2일 이내는 온라인 예약 불가", () => {
    expect(paymentPlan("2026-11-19", at, 1, 1, 1).mode).toBe("closed");
    expect(paymentPlan("2026-11-20", at, 1, 1, 1).mode).toBe("full");
  });
});

describe("출발일 상태", () => {
  const base = { capacity: 20, min_pax: 10, seats_taken: 5, paidSeats: 5, current: "open" };
  it("최소 인원을 넘으면 확정", () => {
    expect(departureStatus({ ...base, seats_taken: 12, paidSeats: 10 })).toBe("confirmed");
    expect(departureStatus({ ...base, seats_taken: 12, paidSeats: 9 })).toBe("open");
  });
  it("좌석이 다 차면 마감", () => {
    expect(departureStatus({ ...base, seats_taken: 20, paidSeats: 3 })).toBe("closed");
  });
  it("취소·출발 완료는 그대로", () => {
    expect(departureStatus({ ...base, current: "cancelled", paidSeats: 20 })).toBe("cancelled");
    expect(departureStatus({ ...base, current: "departed" })).toBe("departed");
  });
});

describe("예약 상태 흐름", () => {
  it("허용된 흐름만", () => {
    expect(canTransition("pending_deposit", "deposit_paid")).toBe(true);
    expect(canTransition("deposit_paid", "fully_paid")).toBe(true);
    expect(canTransition("cancel_requested", "deposit_paid")).toBe(true);
    expect(canTransition("cancelled", "deposit_paid")).toBe(false);
    expect(canTransition("expired", "pending_deposit")).toBe(false);
    expect(canTransition("pending_deposit", "fully_paid")).toBe(false);
  });
});
