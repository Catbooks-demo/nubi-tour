import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { travelerType } from "@/rules/pricing";
import { addDays, diffDays, kstDateTime } from "@/rules/time";
import {
  BOOKING_MAX_DAYS,
  BOOKING_MIN_DAYS,
  buildModel,
  calibration,
  DOW_SHARE,
  GUEST_SHARE,
  PARTY_SHARE,
  partySize,
  PERSONAS,
  personaMass,
  planDay,
  REGION_CODES,
  REGION_SHARE,
  trendMultiple,
  trendOn,
  TREND_FLOOR,
  TREND_PEAK,
  WINDOW_DAYS,
  windowDays,
} from "../scripts/synthetic/model";
import { DEFAULT_OUT, outDirProblem, REPO_ROOT } from "../scripts/synthetic/outdir";
import { Rng } from "../scripts/synthetic/rng";

const END = "2026-11-18";
const CUTOFF = kstDateTime(END, 15).getTime();
const small = () => buildModel({ seed: 7, windowEnd: END, cutoff: CUTOFF, members: 4000, newMembers: 400 });
const sum = (v: readonly number[]) => v.reduce((a, b) => a + b, 0);
const mass = personaMass();
const aggregate = (rows: number[][], j: number) => sum(rows.map((r, i) => r[j] * mass[i])) / sum(mass);

describe("가상 예약: 비중", () => {
  it("설계 표의 비중은 모두 100%", () => {
    expect(sum(REGION_CODES.map((r) => REGION_SHARE[r]))).toBeCloseTo(100, 6);
    expect(sum(DOW_SHARE)).toBeCloseTo(100, 6);
    expect(sum(PARTY_SHARE)).toBeCloseTo(100, 6);
    expect(sum(PERSONAS.map((p) => p.share))).toBeCloseTo(100, 6);
    expect(PERSONAS).toHaveLength(10);
  });

  it("회원 1명당 연 예약은 약 0.44건", () => {
    expect(sum(PERSONAS.map((p) => p.share * p.yearly)) / 100).toBeCloseTo(0.44, 2);
  });

  it("유형별 행선지·일행 비중은 행마다 합 1, 모두 더하면 설계 비중", () => {
    const c = calibration();
    for (const row of [...c.region, ...c.party]) expect(sum(row)).toBeCloseTo(1, 9);
    REGION_CODES.forEach((r, j) => expect(aggregate(c.region, j)).toBeCloseTo(REGION_SHARE[r] / 100, 3));
    PARTY_SHARE.forEach((v, j) => expect(aggregate(c.party, j)).toBeCloseTo(v / 100, 3));
  });

  it("혼자 여행 유형은 늘 1명, 신혼여행은 늘 2명", () => {
    const c = calibration();
    expect(c.party[PERSONAS.findIndex((p) => p.code === "solo")]).toEqual([1, 0, 0, 0]);
    expect(c.party[PERSONAS.findIndex((p) => p.code === "honeymoon")][1]).toBeCloseTo(1, 9);
  });
});

describe("가상 예약: 시드", () => {
  it("같은 시드면 회원과 하루 계획이 같다", () => {
    const a = small();
    const b = small();
    expect(a.members.slice(0, 50)).toEqual(b.members.slice(0, 50));
    expect(a.members.at(-1)).toEqual(b.members.at(-1));
    expect(planDay(a, "2026-11-02")).toEqual(planDay(b, "2026-11-02"));
  });

  it("다른 시드면 다르다", () => {
    const a = small();
    const b = buildModel({ seed: 8, windowEnd: END, cutoff: CUTOFF, members: 4000, newMembers: 400 });
    expect(a.members.slice(0, 20).map((m) => m.email + m.name_ko)).not.toEqual(b.members.slice(0, 20).map((m) => m.email + m.name_ko));
  });

  it("난수는 열쇠로만 정해진다", () => {
    const x = new Rng("k");
    const y = new Rng("k");
    expect([x.random(), x.normal(), x.poisson(3)]).toEqual([y.random(), y.normal(), y.poisson(3)]);
  });

  it("회원 4만 명 중 4천 명이 기간 안에 가입, 가입은 되채운 시각 전", () => {
    const m = buildModel({ seed: 1, windowEnd: END, cutoff: CUTOFF });
    expect(m.members).toHaveLength(40_000);
    const fresh = m.members.filter((x) => x.joinedInWindow);
    expect(fresh).toHaveLength(4_000);
    const start = kstDateTime(m.windowStart).getTime();
    for (const x of fresh) {
      expect(x.joinedAt).toBeGreaterThanOrEqual(start);
      expect(x.joinedAt).toBeLessThan(CUTOFF);
    }
    for (const x of m.members.filter((y) => !y.joinedInWindow)) expect(x.joinedAt).toBeLessThan(start);
    expect(new Set(m.members.map((x) => x.email)).size).toBe(40_000);
    for (const x of m.members.slice(0, 200)) expect(x.email).toMatch(/^m\d{5}@synth\.nubi\.test$/);
  });
});

describe("가상 예약: 트렌드 배수", () => {
  it("발표 전 ×1, 1주 ×1.5, 2~3주 ×2.1, 9주 뒤 ×1.3에서 멈춤", () => {
    expect(trendMultiple(-1)).toBe(1);
    expect(trendMultiple(0)).toBe(1);
    expect(trendMultiple(7)).toBeCloseTo(1.5, 9);
    expect(trendMultiple(14)).toBeCloseTo(2.1, 9);
    expect(trendMultiple(20)).toBe(TREND_PEAK);
    expect(trendMultiple(63)).toBeCloseTo(1.3, 9);
    expect(trendMultiple(400)).toBe(TREND_FLOOR);
    expect(TREND_PEAK).toBe(2.1);
    expect(TREND_FLOOR).toBe(1.3);
  });

  it("최고점은 2.1을 넘지 않고, 3주 뒤로는 줄기만 하며 1.3 밑으로 가지 않는다", () => {
    let prev = Infinity;
    for (let d = 0; d <= 200; d += 0.5) {
      const m = trendMultiple(d);
      expect(m).toBeLessThanOrEqual(TREND_PEAK + 1e-12);
      if (d >= 21) {
        expect(m).toBeLessThanOrEqual(prev + 1e-12);
        expect(m).toBeGreaterThanOrEqual(TREND_FLOOR);
        prev = m;
      }
    }
  });

  it("10/20 발표, 그 전날까지는 평소", () => {
    expect(trendOn("2026-10-19")).toBe(1);
    expect(trendOn("2026-10-20")).toBe(1);
    expect(trendOn("2026-11-03")).toBeCloseTo(2.1, 9);
  });

  it("트렌드 때 중화권 예약의 기대값은 평소의 약 2.1배", () => {
    const m = small();
    const p = planDay(m, "2026-11-05");
    expect(p.expected.china / p.baseline.china).toBeCloseTo(2.1, 1);
    expect(p.multipliers.japan).toBeCloseTo(1.1, 9);
    expect(p.multipliers["southeast-asia"]).toBeCloseTo(0.95, 9);
    const before = planDay(m, "2026-10-10");
    expect(before.expected.china / before.baseline.china).toBeCloseTo(1, 9);
  });
});

describe("가상 예약: 기간", () => {
  const m = small();
  const days = windowDays(m);

  it("예약한 날 기준 오늘 − 60일 ~ 오늘", () => {
    expect(m.windowStart).toBe(addDays(END, -WINDOW_DAYS));
    expect(days[0]).toBe("2026-09-19");
    expect(days.at(-1)).toBe(END);
    expect(days).toHaveLength(WINDOW_DAYS + 1);
  });

  it("기간 시작 전에 예약한 계획은 하나도 없다", () => {
    const start = kstDateTime(m.windowStart).getTime();
    const end = kstDateTime(addDays(END, 1)).getTime();
    let n = 0;
    for (const d of days) {
      const p = planDay(m, d);
      for (const i of p.intents) {
        n++;
        expect(i.t).toBeGreaterThanOrEqual(start);
        expect(i.t).toBeLessThan(end);
        expect(i.t).toBeGreaterThanOrEqual(kstDateTime(d).getTime());
        expect(i.t).toBeLessThan(kstDateTime(addDays(d, 1)).getTime());
        if (i.member !== null) expect(i.t).toBeGreaterThan(m.members[i.member].joinedAt);
        for (const c of i.candidates) {
          expect(diffDays(d, c.date)).toBeGreaterThanOrEqual(BOOKING_MIN_DAYS);
          expect(diffDays(d, c.date)).toBeLessThanOrEqual(BOOKING_MAX_DAYS);
        }
      }
    }
    expect(n).toBeGreaterThan(0);
  });

  it("비회원은 약 20%", () => {
    const all = days.flatMap((d) => planDay(m, d).intents);
    const guests = all.filter((i) => i.member === null).length / all.length;
    expect(Math.abs(guests - GUEST_SHARE)).toBeLessThan(0.05);
    for (const i of all.filter((x) => x.member === null)) expect(i.guestPin).toMatch(/^[0-9]{4,6}$/);
  });
});

describe("가상 예약: 일행", () => {
  it("1명 12% · 2명 45% · 3~4명 33% · 5명 이상 10%", () => {
    const c = calibration();
    const rng = new Rng("party");
    const n = [0, 0, 0, 0];
    const draws = 60_000;
    for (let k = 0; k < draws; k++) {
      const size = partySize(rng, rng.index(mass), c);
      n[size === 1 ? 0 : size === 2 ? 1 : size <= 4 ? 2 : 3]++;
    }
    PARTY_SHARE.forEach((v, j) => expect(Math.abs(n[j] / draws - v / 100)).toBeLessThan(0.01));
  });

  it("아이·유아는 가족 유형에서만, 혼자 가는 예약은 1인실", () => {
    const m = small();
    const family = PERSONAS.findIndex((p) => p.family);
    for (const d of ["2026-10-02", "2026-11-12"]) {
      for (const i of planDay(m, d).intents) {
        const date = i.candidates[0]?.date ?? addDays(d, i.lead);
        const kids = i.travelers.filter((t) => travelerType(t.birth_date, date) !== "adult").length;
        if (i.persona !== family) expect(kids, i.key).toBe(0);
        expect(i.singleRooms).toBe(i.travelers.length === 1 ? 1 : 0);
        expect(i.travelers.length).toBeLessThanOrEqual(9);
        for (const t of i.travelers) {
          expect(t.name_en).toMatch(/^[A-Z][A-Z ]{1,49}$/);
          expect(t.passport_last4).toMatch(/^[0-9]{4}$/);
        }
      }
    }
  });
});

describe("가상 예약: 정답지 위치", () => {
  const gi = readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf-8");

  it("기본 --out(synthetic-out/)은 .gitignore에 있다", () => {
    expect(gi.split(/\r?\n/)).toContain(`${DEFAULT_OUT}/`);
    expect(outDirProblem(path.join(REPO_ROOT, DEFAULT_OUT), REPO_ROOT, gi)).toBeNull();
  });

  it("저장소 안 다른 곳(맨 위·scripts·tests)에는 쓰지 않는다", () => {
    expect(outDirProblem(REPO_ROOT, REPO_ROOT, gi)).not.toBeNull();
    expect(outDirProblem(path.join(REPO_ROOT, "scripts", "out"), REPO_ROOT, gi)).not.toBeNull();
    expect(outDirProblem(path.join(REPO_ROOT, "tests"), REPO_ROOT, gi)).not.toBeNull();
  });

  it("저장소 밖은 괜찮다", () => {
    expect(outDirProblem(path.join(tmpdir(), "nubi-synth"), REPO_ROOT, gi)).toBeNull();
  });
});
