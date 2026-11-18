/**
 * 누비투어 가상 예약 모형 (DB를 건드리지 않는 순수한 부분).
 *
 * 설계: "누비투어 가상 예약" 문서(2026-11-18). 숫자는 그 문서의 표·스크립트 배열(per·reg·lead·dow·asm·mult)
 * 그대로다. 하루 예약량을 위에서 나눠 주지 않는다: 회원마다 1년 예약 횟수가 정해지고, 그날의 요일·추석·
 * 트렌드 효과를 곱한 회원별 기대값을 모두 더한 것이 그날 예약량이다.
 *
 * 같은 시드·같은 날이면 계획이 같다(되채우기와 매일 모드가 같은 날을 같은 모양으로 본다).
 */
import { PRODUCTS, type SeedProduct } from "../../prisma/seed-data/products";
import { planDepartures } from "../../prisma/seed-lib";
import { addDays, diffDays, kstDate, kstDateTime, weekday } from "../../src/rules/time";
import { givenPool, SURNAMES } from "./names";
import { bisect, cumulative, Rng } from "./rng";

// ── 표시 ──
/** 가상 데이터 표시: 가상 회원·비회원 예약자·가상 직원의 이메일은 모두 이 도메인이다 (.test는 실제로 쓰이지 않는 도메인). */
export const SYNTH_DOMAIN = "synth.nubi.test";
export const SYNTH_STAFF_EMAIL = `ops@${SYNTH_DOMAIN}`;
export const isSynthEmail = (email: string) => email.toLowerCase().endsWith(`@${SYNTH_DOMAIN}`);

// ── 크기 (설계 2절) ──
export const DEFAULT_SEED = 20261118;
export const WINDOW_DAYS = 60; // 예약한 날 기준: 오늘 − 60일 ~ 오늘
export const MEMBERS = 40_000;
export const NEW_MEMBERS = 4_000; // 기간 안에 가입
export const GUEST_SHARE = 0.2; // 예약의 20%는 비회원
export const JITTER = 0.3; // 회원마다 ±30%
export const BOOKING_MIN_DAYS = 3; // 출발 2일 안쪽은 온라인 예약을 받지 않는다(누비투어 규칙)
export const BOOKING_MAX_DAYS = 90; // 출발일은 오늘부터 90일 앞까지 열려 있다

// ── 행선지 (설계 3절 reg) ──
export const REGION_CODES = ["southeast-asia", "japan", "china", "europe", "oceania", "americas"] as const;
export type RegionCode = (typeof REGION_CODES)[number];
export const REGION_KO: Record<RegionCode, string> = {
  "southeast-asia": "동남아",
  japan: "일본",
  china: "중화권",
  europe: "유럽",
  oceania: "괌·사이판·대양주",
  americas: "미주·캐나다",
};
/** 예약 건수 비중(%), 평소. */
export const REGION_SHARE: Record<RegionCode, number> = {
  "southeast-asia": 30,
  japan: 30,
  china: 22,
  europe: 8,
  oceania: 6,
  americas: 4,
};
const NEAR: readonly RegionCode[] = ["japan", "china", "southeast-asia"];
const LONG_HAUL: readonly RegionCode[] = ["europe", "americas"];

// ── 예약 시점 (설계 3절 lead, asm "비수기 예약 시점") ──
/** 출발 며칠 전 예약하나(평균, 성수기 출발 기준). */
export const LEAD_MEAN: Record<RegionCode, number> = {
  japan: 36,
  china: 38,
  "southeast-asia": 40,
  oceania: 51,
  americas: 65,
  europe: 73,
};
/** 비수기 가까운 지역은 약 10일 짧게(25~30일). */
export const LEAD_MEAN_OFFSEASON_NEAR: Record<"japan" | "china" | "southeast-asia", number> = {
  japan: 26,
  china: 28,
  "southeast-asia": 30,
};
/** 긴 꼬리: 로그 눈금 표준편차 (출발 3일 전 예약도, 4~5달 전 예약도 섞인다). */
export const LEAD_SIGMA = 0.6;

// ── 요일 (설계 3절 dow, 월~일 %) ──
export const DOW_SHARE = [17.6, 15.4, 15.0, 14.6, 13.6, 11.4, 12.4] as const;
/** 그 날(YYYY-MM-DD)의 요일 효과 (평균 1). */
export function dowIndex(date: string): number {
  const mondayFirst = (weekday(date) + 6) % 7;
  return DOW_SHARE[mondayFirst] / (100 / 7);
}

// ── 시간대 (설계 asm "시간대": 점심 12~13시, 밤 21~23시 두 봉우리, 시니어는 오전) ──
export const HOUR_SHARE = [
  1.2, 0.6, 0.3, 0.2, 0.2, 0.3, 0.7, 1.5, 2.8, 3.8, 4.4, 4.8, 7.4, 7.0, 4.8, 4.4, 4.2, 4.2, 4.4, 5.2, 6.2, 7.6, 8.0, 5.3,
] as const;
const MORNING_TILT: Record<number, number> = { 0: 0.4, 1: 0.4, 2: 0.4, 3: 0.4, 4: 0.5, 5: 0.8, 6: 1.4, 7: 1.9, 8: 2.2, 9: 2.4, 10: 2.2, 11: 1.6, 21: 0.6, 22: 0.5, 23: 0.4 };

// ── 날 효과 (설계 3절) ──
/** 추석 연휴. 그 주(월~일) 예약 −25%. */
export const CHUSEOK: readonly [string, string][] = [
  ["2026-09-24", "2026-09-27"],
  ["2027-09-14", "2027-09-17"],
];
export const CHUSEOK_FACTOR = 0.75;
/** 추석 주(월~일) 안이면 그 주의 [월, 일]. */
export function chuseokWeek(date: string): [string, string] | null {
  for (const [first] of CHUSEOK) {
    const monday = addDays(first, -((weekday(first) + 6) % 7));
    const sunday = addDays(monday, 6);
    if (date >= monday && date <= sunday) return [monday, sunday];
  }
  return null;
}
/** 예약한 날의 효과: 요일 × 추석 주. */
export function bookingDayFactor(date: string): number {
  return dowIndex(date) * (chuseokWeek(date) ? CHUSEOK_FACTOR : 1);
}

/** 출발일 효과: 그 출발일로 몰리는 정도 (예약 건수 총량이 아니라 어느 출발일을 고르나). */
export function departureFactor(date: string): number {
  const md = date.slice(5);
  if (date === "2026-09-24") return 2.0; // 추석 출발 몰림: 9/24 42%
  if (date === "2026-09-23") return 1.5; // 9/23 24%
  if (["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-09"].includes(date)) return 1.3; // 개천절·한글날 연휴
  if (md >= "12-20" || md <= "01-05") return 1.2; // 연말 출발
  if (date >= "2027-02-05" && date <= "2027-02-09") return 1.2; // 설 출발
  return 1;
}
/** 예약 시점이 긴 성수기 출발인가 (연말·여름·설·추석·10월 연휴). */
export function isPeakDeparture(date: string): boolean {
  const md = date.slice(5);
  if (md >= "12-20" || md <= "01-05") return true;
  if (md >= "07-20" && md <= "08-15") return true;
  if (date >= "2027-02-05" && date <= "2027-02-09") return true;
  if (date >= "2026-09-22" && date <= "2026-09-27") return true;
  if (date >= "2026-10-02" && date <= "2026-10-09") return true;
  return false;
}
/** 아이 동반 가족은 방학 출발을 일찍 잡는다(3~4달 전). */
function isSchoolBreak(date: string): boolean {
  const md = date.slice(5);
  return md >= "12-20" || md <= "02-28" || (md >= "07-20" && md <= "08-20");
}

// ── 트렌드 (설계 6절 mult) ──
export const TREND_START = "2026-10-20";
export const TREND_PEAK = 2.1;
export const TREND_FLOOR = 1.3;
export const JAPAN_FACTOR = 1.1; // 엔저: 기간 내내
export const SEA_PEAK_DROP = 0.05; // 트렌드 최고점에서 동남아 −5%

/** 트렌드 시작 뒤 경과 일수 → 중화권 예약 배수. 1주 ×1.5 → 2주 ×2.1 → 3주까지 유지 → 6주에 걸쳐 ×1.3에서 멈춤. */
export function trendMultiple(daysSince: number): number {
  if (daysSince < 0) return 1;
  const w = daysSince / 7;
  if (w < 1) return 1 + 0.5 * w;
  if (w < 2) return 1.5 + 0.6 * (w - 1);
  if (w < 3) return TREND_PEAK;
  return Math.max(TREND_FLOOR, TREND_PEAK - (0.8 * (w - 3)) / 6);
}
export const trendOn = (date: string) => trendMultiple(diffDays(TREND_START, date));

/** 그날 지역별 배수. `cnRel`은 회원의 중국 반응(전체 평균 1). */
export function regionMultipliers(date: string, cnRel = 1): Record<RegionCode, number> {
  const m = trendOn(date);
  return {
    "southeast-asia": 1 - (SEA_PEAK_DROP * (m - 1)) / (TREND_PEAK - 1),
    japan: JAPAN_FACTOR,
    china: 1 + (m - 1) * cnRel,
    europe: 1,
    oceania: 1,
    americas: 1,
  };
}

// ── 일행 (설계 asm "1건당 인원") ──
export const PARTY_BUCKETS = ["1", "2", "3-4", "5+"] as const;
export const PARTY_SHARE = [12, 45, 33, 10] as const;

// ── 예약 뒤의 일 (설계 5절·asm) ──
export const RATES = {
  expire: 0.04, // 예약금 기한을 넘겨 자동 취소
  cancel: 0.09, // 고객 취소
  cancelLongHaul: 0.12, // 유럽·미주
  cancelEarly: 0.75, // 취소 중 수수료 없는 30일 전 취소 몫 (시간이 될 때)
  cancelReject: 0.05, // 직원이 거절하고 예약을 이어 가는 몫 (가정)
  review: 0.05, // 다녀온 예약의 후기
  inquiry: 0.06, // 예약의 문의
  soldOutInquiry: 0.3, // 마감 출발일을 만난 손님의 대기·마감 문의
  minPaxInquiry: 0.25, // 출발 취소 안내를 받은 손님의 환불 문의
};
/** 후기 별점 (평균 약 4.4). */
export const RATING_SHARE: readonly [number, number][] = [
  [5, 0.58],
  [4, 0.3],
  [3, 0.08],
  [2, 0.03],
  [1, 0.01],
];

// ── 여행자 유형 (설계 4절 per) ──
export type CnLevel = "아주 높음" | "높음" | "중간" | "낮음" | "없음";
export const CN_SENS: Record<CnLevel, number> = { "아주 높음": 1.8, 높음: 1.2, 중간: 0.6, 낮음: 0.25, 없음: 0 };

export interface Persona {
  code: string;
  name: string;
  desc: string;
  share: number; // 회원 비중(%)
  yearly: number; // 연 예약
  likes: readonly RegionCode[]; // 즐겨 가는 곳 1·2·3순위 (비면 전체 평균)
  partyTilt: readonly [number, number, number, number]; // 1명·2명·3~4명·5명 이상 기울기 (전체 비중에 맞춰 다시 나눈다)
  leadDays: number; // 예약 시점(일, 표의 가운데 값)
  leadDaysBreak?: number; // 방학 출발이면
  cn: CnLevel;
  ages: readonly [number, number];
  female: number;
  hours: "morning" | "day";
  themes: Readonly<Record<string, number>>;
  family?: boolean; // 아이·유아는 가족 유형에서만
}

export const PERSONAS: readonly Persona[] = [
  { code: "senior_couple", name: "시니어 부부", desc: "60대 이상 · 남녀", share: 18, yearly: 0.55, likes: ["china", "japan", "southeast-asia"], partyTilt: [0.05, 0.8, 0.12, 0.03], leadDays: 60, cn: "아주 높음", ages: [60, 76], female: 0.5, hours: "morning", themes: { parents: 1.6, "no-shopping": 1.2 } },
  { code: "filial", name: "효도여행 자녀", desc: "40~50대 · 여 · 부모님 모시고", share: 8, yearly: 0.35, likes: ["china", "japan", "southeast-asia"], partyTilt: [0, 0.1, 0.75, 0.15], leadDays: 52.5, cn: "아주 높음", ages: [40, 59], female: 0.8, hours: "day", themes: { parents: 3, "no-shopping": 1.3 } },
  { code: "friends_5060", name: "5060 친구 모임", desc: "50~60대 · 여", share: 10, yearly: 0.45, likes: ["southeast-asia", "japan", "europe"], partyTilt: [0.02, 0.2, 0.48, 0.3], leadDays: 50, cn: "높음", ages: [50, 66], female: 0.9, hours: "morning", themes: { nature: 1.4, city: 1.2 } },
  { code: "family_40s", name: "40대 가족", desc: "40대 · 남녀 · 자녀 동반", share: 14, yearly: 0.4, likes: ["southeast-asia", "oceania", "japan"], partyTilt: [0, 0.08, 0.77, 0.15], leadDays: 40, leadDaysBreak: 105, cn: "중간", ages: [38, 49], female: 0.55, hours: "day", themes: { family: 3, resort: 1.5 }, family: true },
  { code: "couple_30s", name: "30대 부부·커플", desc: "30대 · 남녀", share: 12, yearly: 0.45, likes: ["japan", "southeast-asia", "europe"], partyTilt: [0.05, 0.85, 0.08, 0.02], leadDays: 37.5, cn: "낮음", ages: [30, 39], female: 0.5, hours: "day", themes: { city: 1.5, "free-time": 1.4 } },
  { code: "honeymoon", name: "신혼여행", desc: "20~30대 · 남녀", share: 4, yearly: 0.1, likes: ["europe", "oceania", "americas"], partyTilt: [0, 1, 0, 0], leadDays: 120, cn: "없음", ages: [26, 36], female: 0.5, hours: "day", themes: { honeymoon: 4, resort: 2 } },
  { code: "friends_2030", name: "2030 친구", desc: "20~30대 · 여", share: 9, yearly: 0.5, likes: ["japan", "southeast-asia"], partyTilt: [0.05, 0.55, 0.38, 0.02], leadDays: 25, cn: "중간", ages: [20, 34], female: 0.8, hours: "day", themes: { city: 1.6, "free-time": 1.5 } },
  { code: "solo", name: "혼자 여행", desc: "30~60대 · 남녀", share: 8, yearly: 0.5, likes: ["japan", "china", "europe"], partyTilt: [1, 0, 0, 0], leadDays: 32.5, cn: "중간", ages: [30, 65], female: 0.55, hours: "day", themes: { "free-time": 1.4, "no-shopping": 1.2 } },
  { code: "longhaul", name: "장거리 마니아", desc: "50대 이상 · 남녀", share: 5, yearly: 0.4, likes: ["europe", "americas"], partyTilt: [0.1, 0.75, 0.12, 0.03], leadDays: 95, cn: "낮음", ages: [50, 72], female: 0.5, hours: "morning", themes: { nature: 1.4 } },
  { code: "blank", name: "프로필 비움", desc: "선택 항목 없음", share: 12, yearly: 0.4, likes: [], partyTilt: [0.12, 0.45, 0.33, 0.1], leadDays: 43, cn: "중간", ages: [22, 70], female: 0.5, hours: "day", themes: {} },
];

// ── 보정: 유형 기울기를 전체 비중에 맞추기 ──
/** 행 비율 맞추기(IPF): 행마다 합 1을 지키면서, 행 무게로 더한 열 합이 목표 비중이 되게. 0인 칸은 0으로 남는다. */
export function fitRows(rows: number[][], rowMass: number[], target: number[], iters = 300): number[][] {
  const t = target.map((v) => v / target.reduce((a, b) => a + b, 0));
  let r = rows.map((row) => normalize(row));
  for (let it = 0; it < iters; it++) {
    const col = t.map((_, j) => r.reduce((s, row, i) => s + rowMass[i] * row[j], 0) / rowMass.reduce((a, b) => a + b, 0));
    r = r.map((row) => normalize(row.map((v, j) => (col[j] > 0 ? (v * t[j]) / col[j] : v))));
  }
  return r;
}
export function normalize(v: number[]): number[] {
  const s = v.reduce((a, b) => a + b, 0);
  return s > 0 ? v.map((x) => x / s) : v.map(() => 1 / v.length);
}
/** 유형별 예약 무게 (회원 비중 × 연 예약). */
export const personaMass = () => PERSONAS.map((p) => p.share * p.yearly);

export interface Calibration {
  region: number[][]; // 유형 × REGION_CODES
  party: number[][]; // 유형 × PARTY_BUCKETS
  leadNorm: Record<RegionCode, number>; // 지역마다 유형 예약 시점 배수의 평균(=1로 맞추려고 나눌 값)
}

let calibrationCache: Calibration | null = null;
export function calibration(): Calibration {
  if (calibrationCache) return calibrationCache;
  const mass = personaMass();
  const regionTilt = PERSONAS.map((p) =>
    REGION_CODES.map((r) => {
      if (!p.likes.length) return REGION_SHARE[r];
      const rank = p.likes.indexOf(r);
      return REGION_SHARE[r] * (rank === 0 ? 3 : rank === 1 ? 2 : rank === 2 ? 1.5 : 0.2);
    }),
  );
  const region = fitRows(regionTilt, mass, REGION_CODES.map((r) => REGION_SHARE[r]));
  const party = fitRows(PERSONAS.map((p) => [...p.partyTilt]), mass, [...PARTY_SHARE]);
  const leadNorm = {} as Record<RegionCode, number>;
  REGION_CODES.forEach((r, j) => {
    let num = 0;
    let den = 0;
    PERSONAS.forEach((p, i) => {
      const w = mass[i] * region[i][j];
      num += w * (p.leadDays / 43);
      den += w;
    });
    leadNorm[r] = num / den;
  });
  calibrationCache = { region, party, leadNorm };
  return calibrationCache;
}

// ── 회원 ──
export interface Person {
  surname: number; // SURNAMES 번호
  name_ko: string;
  name_en: string;
  gender: "F" | "M";
  birth_date: string;
}

export interface Member extends Person {
  index: number; // 0부터
  email: string;
  phone: string;
  persona: number;
  joinedAt: number; // ms
  joinedInWindow: boolean;
  marketing: boolean;
  yearly: number;
  regionW: number[];
  cnSens: number;
  hourStrength: number;
}

export interface ModelConfig {
  seed: number;
  /** 기간 마지막 날(한국 날짜, 되채우기한 날). */
  windowEnd: string;
  /** 되채우기가 넣은 마지막 시각(ms). 새 회원의 가입은 그 전. */
  cutoff: number;
  members?: number;
  newMembers?: number;
}

export interface Model {
  seed: number;
  windowStart: string;
  windowEnd: string;
  cutoff: number;
  members: Member[];
  cnNorm: number;
  calib: Calibration;
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");
export const memberEmail = (index: number) => `m${pad(index + 1, 5)}@${SYNTH_DOMAIN}`;

function phoneOf(rng: Rng): string {
  return `010${pad(rng.int(0, 99_999_999), 8)}`;
}

/** 나이 → 생년월일 (기준일에 만 age세). */
export function birthForAge(rng: Rng, age: number, on: string): string {
  const [y, m, d] = on.split("-").map(Number);
  // 기준일보다 1~364일 앞선 생일 → 기준일에 정확히 만 age세
  const back = rng.int(1, 364);
  const birthday = new Date(Date.UTC(y - age, m - 1, d - back));
  return birthday.toISOString().slice(0, 10);
}

export function makePerson(rng: Rng, gender: "F" | "M", age: number, on: string, surname?: number): Person {
  const s = surname ?? rng.index(SURNAMES.map((x) => x[2]));
  const birth = birthForAge(rng, age, on);
  const [gko, gen] = rng.pick(givenPool(Number(birth.slice(0, 4)), gender));
  return { surname: s, name_ko: SURNAMES[s][0] + gko, name_en: `${SURNAMES[s][1]} ${gen}`, gender, birth_date: birth };
}

const windowStartOf = (end: string) => addDays(end, -WINDOW_DAYS);

export function buildModel(cfg: ModelConfig): Model {
  const count = cfg.members ?? MEMBERS;
  const fresh = Math.min(count, cfg.newMembers ?? NEW_MEMBERS);
  const windowStart = windowStartOf(cfg.windowEnd);
  const startMs = kstDateTime(windowStart).getTime();
  const calib = calibration();
  const rng = new Rng(`${cfg.seed}:members`);
  const personaW = PERSONAS.map((p) => p.share);
  const HOUR_CUM = hourCum("day", 1);

  // 가입 시각: 예전 회원은 기간 전 3년 안, 새 회원은 기간 안. 이메일 번호가 가입 순서가 되게 정렬한다.
  const oldJoins = Array.from({ length: count - fresh }, () => startMs - rng.uniform(1, 1095) * 86_400_000);
  const span = Math.max(60_000, cfg.cutoff - startMs);
  const newJoins = Array.from({ length: fresh }, () => {
    const day = Math.floor(rng.random() * (span / 86_400_000));
    const date = addDays(windowStart, day);
    const hour = bisect(HOUR_CUM, rng.random() * HOUR_CUM[23]);
    const t = kstDateTime(date, hour, rng.int(0, 59), rng.int(0, 59)).getTime();
    return Math.min(t, cfg.cutoff - rng.uniform(5, 600) * 60_000);
  });
  oldJoins.sort((a, b) => a - b);
  newJoins.sort((a, b) => a - b);
  const joins = [...oldJoins, ...newJoins];

  const members: Member[] = [];
  for (let i = 0; i < count; i++) {
    const pi = rng.index(personaW);
    const p = PERSONAS[pi];
    const gender = rng.chance(p.female) ? "F" : "M";
    const person = makePerson(rng, gender, rng.int(p.ages[0], p.ages[1]), cfg.windowEnd);
    const regionW = normalize(calib.region[pi].map((w) => w * rng.jitter(JITTER)));
    members.push({
      ...person,
      index: i,
      email: memberEmail(i),
      phone: phoneOf(rng),
      persona: pi,
      joinedAt: Math.floor(joins[i] / 1000) * 1000,
      joinedInWindow: i >= count - fresh,
      marketing: rng.chance(0.35),
      yearly: p.yearly * rng.jitter(JITTER),
      regionW,
      cnSens: CN_SENS[p.cn] * rng.jitter(JITTER),
      hourStrength: rng.jitter(JITTER),
    });
  }
  // 중국 반응 보정: 중화권 수요로 가중한 평균 반응이 1이 되게 (그래야 전체 중화권 배수가 mult 곡선이 된다)
  const ci = REGION_CODES.indexOf("china");
  let num = 0;
  let den = 0;
  for (const m of members) {
    num += m.yearly * m.regionW[ci] * m.cnSens;
    den += m.yearly * m.regionW[ci];
  }
  return { seed: cfg.seed, windowStart, windowEnd: cfg.windowEnd, cutoff: cfg.cutoff, members, cnNorm: num / den, calib };
}

// ── 시간대 ──
const hourCache = new Map<string, number[]>();
export function hourCum(profile: "morning" | "day", strength: number): number[] {
  const key = `${profile}:${strength.toFixed(1)}`;
  const hit = hourCache.get(key);
  if (hit) return hit;
  const w = HOUR_SHARE.map((v, h) => {
    const tilt = profile === "morning" ? (MORNING_TILT[h] ?? 1) : 1;
    return v * (1 + (tilt - 1) * strength);
  });
  const cum = cumulative(w);
  hourCache.set(key, cum);
  return cum;
}

// ── 출발일 목록 ──
const productByCode = new Map(PRODUCTS.map((p) => [p.code, p]));
export const productOf = (code: string): SeedProduct | undefined => productByCode.get(code);

export interface DepartureRef {
  product: string;
  date: string;
}
/** 지역별, [from, to] 사이 출발일 (seed-lib planDepartures와 같은 날짜). */
export function departuresBetween(from: string, to: string): Map<RegionCode, DepartureRef[]> {
  const out = new Map<RegionCode, DepartureRef[]>(REGION_CODES.map((r) => [r, []]));
  const n = diffDays(from, to);
  for (const p of PRODUCTS) {
    const list = out.get(p.region as RegionCode);
    if (!list) continue;
    for (const d of planDepartures(p, from, { from: 0, to: n })) list.push({ product: p.code, date: d.depart_date });
  }
  for (const list of out.values()) list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

// ── 예약 시점 ──
function leadMeanFor(region: RegionCode, persona: Persona, peak: boolean, schoolBreak: boolean, calib: Calibration): number {
  const base = !peak && NEAR.includes(region) ? LEAD_MEAN_OFFSEASON_NEAR[region as "japan"] : LEAD_MEAN[region];
  const days = persona.leadDaysBreak && schoolBreak ? persona.leadDaysBreak : persona.leadDays;
  return (base * (days / 43)) / calib.leadNorm[region];
}
/** 그 출발일의 평균 예약 시점: 지역 평균(성수기·비수기) × 유형 배수(지역 안 평균 1로 맞춤). */
export function leadMean(region: RegionCode, persona: Persona, departDate: string, calib: Calibration): number {
  return leadMeanFor(region, persona, isPeakDeparture(departDate), isSchoolBreak(departDate), calib);
}

/** 로그정규 예약 시점(일). 성수기 출발이면 성수기 평균으로, 아니면 비수기 평균으로 같은 난수를 다시 쓴다. */
export function sampleLead(rng: Rng, region: RegionCode, persona: Persona, bookingDay: string, calib: Calibration): number {
  for (let attempt = 0; attempt < 30; attempt++) {
    const z = rng.normal();
    const draw = (mean: number) => mean * Math.exp(LEAD_SIGMA * z - (LEAD_SIGMA * LEAD_SIGMA) / 2);
    // 먼저 비수기 평균으로 출발일을 잡고, 그 날이 성수기·방학이면 그 평균으로 같은 난수를 다시 쓴다
    const off = leadMeanFor(region, persona, false, false, calib);
    let lead = draw(off);
    const mean = leadMean(region, persona, addDays(bookingDay, Math.round(lead)), calib);
    if (mean !== off) lead = draw(mean);
    const days = Math.round(lead);
    if (days >= BOOKING_MIN_DAYS && days <= BOOKING_MAX_DAYS) return days;
  }
  return BOOKING_MIN_DAYS + rng.int(0, 20);
}

/** 정규분포 누적 (Abramowitz–Stegun). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

/** 출발일에 들어와야 할 예약 중 기간 시작 전에 들어왔을 몫 (= 만들지 않아 빠진 몫). */
export function missingShare(region: RegionCode, departDate: string, windowStart: string): number {
  const calib = calibration();
  const mass = personaMass();
  const j = REGION_CODES.indexOf(region);
  const x = diffDays(windowStart, departDate); // 이보다 오래전 예약은 없다
  if (x <= 0) return 1;
  if (x >= BOOKING_MAX_DAYS) return 0; // 예약은 90일 앞까지만 열려 있다
  let num = 0;
  let den = 0;
  PERSONAS.forEach((p, i) => {
    const w = mass[i] * calib.region[i][j];
    if (w <= 0) return;
    const mean = leadMean(region, p, departDate, calib);
    const mu = Math.log(mean) - (LEAD_SIGMA * LEAD_SIGMA) / 2;
    const over = (days: number) => 1 - normCdf((Math.log(days + 0.5) - mu) / LEAD_SIGMA);
    // 3~90일로 자른 분포에서 x일보다 앞선 몫
    const inRange = 1 - over(BOOKING_MAX_DAYS) - (1 - over(BOOKING_MIN_DAYS - 1));
    num += (w * (over(x) - over(BOOKING_MAX_DAYS))) / Math.max(1e-9, inRange);
    den += w;
  });
  return den ? num / den : 0;
}

// ── 하루 계획 ──
export interface TravelerPlan {
  name_ko: string;
  name_en: string;
  gender: "F" | "M";
  birth_date: string;
  passport_last4: string;
}

export interface Fate {
  expire: boolean;
  payDelayMin: number;
  balanceDaysBefore: number; // 잔금 기한 며칠 전에 내나 (3~10)
  cancel: null | { early: boolean; frac: number; reject: boolean; decideDelayH: number; reason: number };
  inquiry: null | { frac: number; kind: number; answerDelayH: number };
  review: null | { daysAfter: number; rating: number; text: number };
  soldOutInquiry: boolean;
  minPaxInquiry: boolean;
  answerDelayH: number;
}

export interface Intent {
  key: string; // 날짜#순번
  t: number; // 예약하는 시각(ms)
  day: string;
  member: number | null; // 회원 번호, 비회원이면 null
  persona: number;
  region: RegionCode;
  lead: number;
  candidates: DepartureRef[];
  contact: { name: string; phone: string; email: string };
  bookerBirth: string;
  travelers: TravelerPlan[];
  singleRooms: number;
  guestPin: string | null;
  fate: Fate;
}

export interface DayPlan {
  date: string;
  dowIndex: number;
  chuseok: boolean;
  trend: number;
  multipliers: Record<RegionCode, number>;
  /** 기대 예약 수 (트렌드 반영, 지역별) */
  expected: Record<RegionCode, number>;
  /** 트렌드가 없었다면 (중화권 배수 1, 동남아 그대로) */
  baseline: Record<RegionCode, number>;
  intents: Intent[];
}

const zeroRegions = (): Record<RegionCode, number> =>
  Object.fromEntries(REGION_CODES.map((r) => [r, 0])) as Record<RegionCode, number>;

/**
 * 한국 날짜 하루의 예약 계획. 회원마다 그날 기대값 λ(연 예약/365 × 요일·추석 × 지역 배수)를 더해 포아송으로
 * 예약 수를 뽑고, λ에 비례해 회원을 고른다(회원마다 포아송으로 뽑는 것과 같은 분포). 비회원은 회원 예약의 1/4(전체 20%).
 */
export function planDay(model: Model, date: string): DayPlan {
  const rng = new Rng(`${model.seed}:day:${date}`);
  const dayStart = kstDateTime(date).getTime();
  const dayEnd = dayStart + 86_400_000;
  const factor = bookingDayFactor(date);
  const plain = regionMultipliers(date, 1);
  const flat = { ...plain, china: 1, "southeast-asia": 1 };
  const ci = REGION_CODES.indexOf("china");

  const lam = new Float64Array(model.members.length);
  const expected = zeroRegions();
  const baseline = zeroRegions();
  let total = 0;
  for (const m of model.members) {
    if (m.joinedAt >= dayEnd) continue;
    const part = m.joinedAt > dayStart ? (dayEnd - m.joinedAt) / 86_400_000 : 1;
    const rate = (m.yearly / 365) * factor * part;
    const cnRel = m.cnSens / model.cnNorm;
    let s = 0;
    REGION_CODES.forEach((r, j) => {
      const mult = j === ci ? 1 + (plain.china - 1) * cnRel : plain[r];
      const v = rate * m.regionW[j] * mult;
      s += v;
      expected[r] += v;
      baseline[r] += rate * m.regionW[j] * flat[r];
    });
    lam[m.index] = s;
    total += s;
  }
  const cum = cumulative(Array.from(lam));
  const guestRatio = GUEST_SHARE / (1 - GUEST_SHARE);
  for (const r of REGION_CODES) {
    expected[r] *= 1 + guestRatio;
    baseline[r] *= 1 + guestRatio;
  }

  // 비회원: 유형은 예약 무게대로, 중국 반응은 유형 평균
  const mass = personaMass();
  const guestPersonaW = PERSONAS.map((p, i) => {
    const cnRel = CN_SENS[p.cn] / model.cnNorm;
    return mass[i] * REGION_CODES.reduce((s, r, j) => s + model.calib.region[i][j] * (j === ci ? 1 + (plain.china - 1) * cnRel : plain[r]), 0);
  });

  type Slot = { t: number; member: number | null; persona: number; region: RegionCode };
  const slots: Slot[] = [];
  const nMembers = rng.poisson(total);
  for (let k = 0; k < nMembers; k++) {
    const mi = bisect(cum, rng.random() * total);
    const m = model.members[mi];
    const p = PERSONAS[m.persona];
    const cnRel = m.cnSens / model.cnNorm;
    const w = REGION_CODES.map((r, j) => m.regionW[j] * (j === ci ? 1 + (plain.china - 1) * cnRel : plain[r]));
    const region = REGION_CODES[rng.index(w)];
    const hours = hourCum(p.hours, m.hourStrength);
    let t = 0;
    for (let tries = 0; tries < 20; tries++) {
      const h = bisect(hours, rng.random() * hours[23]);
      t = dayStart + h * 3_600_000 + rng.int(0, 3599) * 1000;
      if (t > m.joinedAt) break;
    }
    if (t <= m.joinedAt) t = m.joinedAt + rng.int(5, 120) * 60_000;
    if (t >= dayEnd) continue; // 그날 밤늦게 가입해 그날은 예약하지 않음
    slots.push({ t, member: mi, persona: m.persona, region });
  }
  const nGuests = rng.poisson(total * guestRatio);
  for (let k = 0; k < nGuests; k++) {
    const pi = rng.index(guestPersonaW);
    const p = PERSONAS[pi];
    const cnRel = CN_SENS[p.cn] / model.cnNorm;
    const w = REGION_CODES.map((r, j) => model.calib.region[pi][j] * (j === ci ? 1 + (plain.china - 1) * cnRel : plain[r]));
    const region = REGION_CODES[rng.index(w)];
    const hours = hourCum(p.hours, 1);
    const h = bisect(hours, rng.random() * hours[23]);
    slots.push({ t: dayStart + h * 3_600_000 + rng.int(0, 3599) * 1000, member: null, persona: pi, region });
  }
  slots.sort((a, b) => a.t - b.t || (a.member ?? -1) - (b.member ?? -1));

  const catalog = departuresBetween(addDays(date, BOOKING_MIN_DAYS), addDays(date, BOOKING_MAX_DAYS));
  const intents = slots.map((s, k) => makeIntent(model, date, k, s, catalog));
  return {
    date,
    dowIndex: dowIndex(date),
    chuseok: chuseokWeek(date) !== null,
    trend: trendOn(date),
    multipliers: plain,
    expected,
    baseline,
    intents,
  };
}

function productWeight(p: SeedProduct, persona: Persona): number {
  let w = 1;
  for (const t of p.themes) w *= persona.themes[t] ?? 1;
  return w;
}

/** 목표 출발일 근처에서 고를 출발일 후보 (앞이 첫 선택, 나머지는 마감일 때 다음 선택). */
export function chooseDepartures(
  rng: Rng,
  list: readonly DepartureRef[],
  target: string,
  persona: Persona,
  bookingDay: string,
  max = 6,
): DepartureRef[] {
  const lo = addDays(bookingDay, BOOKING_MIN_DAYS);
  const hi = addDays(bookingDay, BOOKING_MAX_DAYS);
  for (const width of [3, 7, 21, 90]) {
    const pool = list.filter((d) => d.date >= lo && d.date <= hi && Math.abs(diffDays(target, d.date)) <= width);
    if (!pool.length) continue;
    const weights = pool.map((d) => {
      const p = productOf(d.product);
      return (p ? productWeight(p, persona) : 1) * departureFactor(d.date) * (width + 1 - Math.abs(diffDays(target, d.date)));
    });
    const out: DepartureRef[] = [];
    const w = [...weights];
    while (out.length < max && w.some((x) => x > 0)) {
      const i = rng.index(w);
      out.push(pool[i]);
      w[i] = 0;
    }
    return out;
  }
  return [];
}

function passportLast4(rng: Rng): string {
  return pad(rng.int(0, 9999), 4);
}

/** 일행 크기: 유형의 1명·2명·3~4명·5명 이상 비중에서. */
export function partySize(rng: Rng, persona: number, calib: Calibration): number {
  const bucket = rng.index(calib.party[persona]);
  if (bucket === 0) return 1;
  if (bucket === 1) return 2;
  if (bucket === 2) return rng.chance(PERSONAS[persona].family ? 0.55 : 0.45) ? 4 : 3;
  return [5, 6, 7, 8][rng.index([0.6, 0.25, 0.1, 0.05])];
}

const ageOf = (birth: string, on: string) => {
  const [by, bm, bd] = birth.split("-").map(Number);
  const [oy, om, od] = on.split("-").map(Number);
  return oy - by - (om < bm || (om === bm && od < bd) ? 1 : 0);
};

/** 일행 여행자 (예약자가 첫 여행자). 아이·유아는 가족 유형에서만. */
export function partyMembers(rng: Rng, persona: Persona, size: number, booker: Person, target: string, bookingDay: string): Person[] {
  const out: Person[] = [booker];
  const bAge = ageOf(booker.birth_date, target);
  const other = (g: "F" | "M"): "F" | "M" => (g === "F" ? "M" : "F");
  const near = (age: number, spread: number) => Math.max(20, age + rng.int(-spread, spread));
  const peer = (age: number, spread: number, female = persona.female) =>
    makePerson(rng, rng.chance(female) ? "F" : "M", near(age, spread), target);

  if (persona.family && size >= 3) {
    const spouse = makePerson(rng, other(booker.gender), near(bAge, 3), target);
    out.push(spouse);
    const familySurname = booker.gender === "M" ? booker.surname : spouse.surname;
    const kids = Math.min(size - 2, 4);
    let infants = 0;
    for (let i = 0; i < kids; i++) {
      if (infants === 0 && rng.chance(0.12)) {
        // 유아: 출발일 기준 만 2세 미만, 예약일에 이미 태어남
        const back = rng.int(Math.max(30, diffDays(bookingDay, target) + 14), 600);
        const birth = addDays(target, -back);
        const g = rng.chance(0.5) ? "F" : "M";
        const [gko, gen] = rng.pick(givenPool(Number(birth.slice(0, 4)), g));
        out.push({ surname: familySurname, name_ko: SURNAMES[familySurname][0] + gko, name_en: `${SURNAMES[familySurname][1]} ${gen}`, gender: g, birth_date: birth });
        infants++;
      } else {
        out.push(makePerson(rng, rng.chance(0.5) ? "F" : "M", rng.int(2, 13), target, familySurname));
      }
    }
    while (out.length < size) out.push(makePerson(rng, rng.chance(0.5) ? "F" : "M", rng.int(66, 80), target)); // 조부모
    return out;
  }
  if (persona.code === "filial") {
    // 부모님 + (본인) + 배우자·형제
    const parentAge = Math.min(90, bAge + rng.int(24, 32));
    const dadSurname = booker.surname;
    if (size >= 2) out.push(makePerson(rng, "F", parentAge - rng.int(0, 4), target));
    if (size >= 3) out.push(makePerson(rng, "M", parentAge, target, dadSurname));
    while (out.length < size) out.push(peer(bAge, 6, 0.6));
    return out;
  }
  if (size >= 2 && ["senior_couple", "couple_30s", "honeymoon", "longhaul", "family_40s"].includes(persona.code)) {
    out.push(makePerson(rng, other(booker.gender), near(bAge, persona.code === "honeymoon" ? 3 : 4), target));
    while (out.length < size) out.push(peer(bAge, 5, 0.5));
    return out;
  }
  while (out.length < size) out.push(peer(bAge, persona.code === "blank" ? 10 : 5));
  return out;
}

export const CANCEL_REASONS = [
  "일정이 바뀌어서 못 가게 됐어요.",
  "가족 건강 문제로 여행을 미뤄야 해요.",
  "회사 일정과 겹쳤어요.",
  "일행 중 한 명이 사정이 생겼어요.",
  "다른 날짜로 다시 알아보려고 해요.",
];

export const INQUIRY_KINDS: readonly { category: "booking" | "payment" | "product" | "etc"; title: string; body: string; answer: string; w: number }[] = [
  { category: "product", title: "일정 문의", body: "둘째 날 일정에 자유 시간이 얼마나 있는지 궁금해요.", answer: "둘째 날은 오후 3시간 정도 자유 시간이 있어요. 현지 가이드가 근처 추천 장소를 안내해 드려요.", w: 0.3 },
  { category: "etc", title: "준비물 문의", body: "현지 날씨에 맞는 옷차림과 콘센트(전압) 정보를 알려 주세요.", answer: "출발 3일 전 보내 드리는 여행 안내문에 날씨·전압·준비물이 모두 있어요. 얇은 겉옷을 챙겨 오시면 좋아요.", w: 0.25 },
  { category: "booking", title: "여행자 정보 변경", body: "여행자 영문 이름 철자를 고치고 싶어요. 어떻게 하면 되나요?", answer: "여권 사본을 회신해 주시면 영문 이름을 고쳐 드릴게요. 발권 전이라 추가 비용은 없어요.", w: 0.2 },
  { category: "payment", title: "잔금 결제 문의", body: "잔금은 언제까지 어떻게 내면 되나요?", answer: "잔금은 출발 7일 전까지 예약 상세 화면에서 결제하시면 돼요. 기한 3일 전에 문자로도 안내해 드려요.", w: 0.15 },
  { category: "booking", title: "객실 배정 문의", body: "일행과 같은 층 객실로 배정해 주실 수 있나요?", answer: "호텔에 요청해 둘게요. 현지 사정에 따라 어려울 수 있는 점 양해 부탁드려요.", w: 0.1 },
];
export const SOLD_OUT_INQUIRY = { category: "product" as const, title: "마감된 출발일 대기 문의", body: "원하던 출발일이 마감이던데 대기 신청이 되나요? 다른 날짜도 괜찮아요.", answer: "대기 명단에 올려 두었어요. 자리가 나면 바로 연락드리고, 가까운 다른 출발일도 함께 안내해 드릴게요." };
export const MIN_PAX_INQUIRY = { category: "cancel" as const, title: "출발 취소 환불 문의", body: "출발이 취소됐다는 안내를 받았어요. 환불은 언제 들어오나요?", answer: "낸 금액은 전액 환불했어요. 카드사에 따라 3~5영업일 안에 들어와요. 불편을 드려 죄송해요." };
export const REVIEW_TEXTS: Record<number, readonly string[]> = {
  5: ["가이드님이 친절하고 일정이 알차서 부모님이 정말 좋아하셨어요.", "숙소와 식사 모두 기대 이상이었어요. 다음에도 누비투어로 갈게요.", "이동이 편하고 자유 시간도 넉넉해서 만족스러웠어요."],
  4: ["전체적으로 좋았는데 첫날 이동 시간이 조금 길었어요.", "일정은 만족스러웠고 식사가 조금 아쉬웠어요.", "가이드 설명이 좋았어요. 쇼핑 시간은 줄였으면 해요."],
  3: ["무난했어요. 호텔 위치가 시내에서 조금 멀었어요.", "일정이 빡빡해서 조금 피곤했어요."],
  2: ["버스 대기 시간이 길고 안내가 부족했어요."],
  1: ["일정 변경 안내가 늦어서 많이 불편했어요."],
};

function fateFor(rng: Rng, region: RegionCode, member: boolean): Fate {
  const cancelRate = LONG_HAUL.includes(region) ? RATES.cancelLongHaul : RATES.cancel;
  const rating = RATING_SHARE[rng.index(RATING_SHARE.map((r) => r[1]))][0];
  // 후기는 회원만 쓸 수 있어서, 전체 다녀온 예약의 5%가 되게 회원 몫을 1/(1−비회원 비중)배로
  const reviewRate = RATES.review / (1 - GUEST_SHARE);
  return {
    expire: rng.chance(RATES.expire),
    payDelayMin: Math.min(22 * 60, Math.max(2, rng.lognormal(45, 1))),
    balanceDaysBefore: rng.uniform(3, 10),
    cancel: rng.chance(cancelRate)
      ? { early: rng.chance(RATES.cancelEarly), frac: rng.random(), reject: rng.chance(RATES.cancelReject), decideDelayH: rng.uniform(2, 26), reason: rng.int(0, CANCEL_REASONS.length - 1) }
      : null,
    inquiry: rng.chance(RATES.inquiry) ? { frac: rng.random(), kind: rng.index(INQUIRY_KINDS.map((k) => k.w)), answerDelayH: rng.uniform(1.5, 30) } : null,
    review: member && rng.chance(reviewRate) ? { daysAfter: rng.uniform(1, 14), rating, text: rng.int(0, REVIEW_TEXTS[rating].length - 1) } : null,
    soldOutInquiry: rng.chance(RATES.soldOutInquiry),
    minPaxInquiry: rng.chance(RATES.minPaxInquiry),
    answerDelayH: rng.uniform(1.5, 30),
  };
}

function makeIntent(
  model: Model,
  date: string,
  k: number,
  s: { t: number; member: number | null; persona: number; region: RegionCode },
  catalog: Map<RegionCode, DepartureRef[]>,
): Intent {
  const key = `${date}#${pad(k, 4)}`;
  const rng = new Rng(`${model.seed}:intent:${key}`);
  const persona = PERSONAS[s.persona];
  const lead = sampleLead(rng, s.region, persona, date, model.calib);
  const target = addDays(date, lead);
  const candidates = chooseDepartures(rng, catalog.get(s.region) ?? [], target, persona, date);
  const m = s.member === null ? null : model.members[s.member];
  const booker: Person = m ?? makePerson(rng, rng.chance(persona.female) ? "F" : "M", rng.int(persona.ages[0], persona.ages[1]), target);
  const size = partySize(rng, s.persona, model.calib);
  const people = partyMembers(rng, persona, size, booker, target, date);
  const travelers = people.map((p) => ({ name_ko: p.name_ko, name_en: p.name_en, gender: p.gender, birth_date: p.birth_date, passport_last4: passportLast4(rng) }));
  const pinLen = rng.chance(0.5) ? 6 : 4;
  const guestPin = m ? null : pad(rng.int(0, 10 ** pinLen - 1), pinLen);
  const contact = m
    ? { name: m.name_ko, phone: m.phone, email: m.email }
    : { name: booker.name_ko, phone: phoneOf(rng), email: `guest.${date.replace(/-/g, "")}.${pad(k, 4)}@${SYNTH_DOMAIN}` };
  return {
    key,
    t: s.t,
    day: date,
    member: s.member,
    persona: s.persona,
    region: s.region,
    lead,
    candidates,
    contact,
    bookerBirth: booker.birth_date,
    travelers,
    singleRooms: size === 1 ? 1 : 0,
    guestPin,
    fate: fateFor(rng, s.region, m !== null),
  };
}

/** 기간의 날짜들 (시작 ~ 끝, 양 끝 포함). */
export function windowDays(model: Pick<Model, "windowStart" | "windowEnd">): string[] {
  const n = diffDays(model.windowStart, model.windowEnd);
  return Array.from({ length: n + 1 }, (_, i) => addDays(model.windowStart, i));
}

/** 그 시각의 한국 날짜에서 만 나이. */
export function ageAt(birth: string, at: number): number {
  return ageOf(birth, kstDate(new Date(at)));
}

// ── 시작 구간 효과 ──
export const START_EFFECT_THRESHOLD = 0.2;
export interface StartEffectRow {
  product: string;
  region: RegionCode;
  depart_date: string;
  missing_share: number;
}
/** 기간 시작 전에 들어왔어야 할 예약이 20% 이상 빠진 출발일 (기간 안 출발일 ~ 앞으로). */
export function startEffect(windowStart: string, lastDepart: string): { rows: StartEffectRow[]; clearFrom: Record<RegionCode, string> } {
  const cat = departuresBetween(addDays(windowStart, BOOKING_MIN_DAYS), lastDepart);
  const rows: StartEffectRow[] = [];
  const clearFrom = {} as Record<RegionCode, string>;
  for (const r of REGION_CODES) {
    let clear: string | null = null;
    for (const d of cat.get(r) ?? []) {
      const share = missingShare(r, d.date, windowStart);
      if (share >= START_EFFECT_THRESHOLD) rows.push({ product: d.product, region: r, depart_date: d.date, missing_share: Math.round(share * 1000) / 1000 });
      else if (!clear) clear = d.date;
    }
    clearFrom[r] = clear ?? addDays(lastDepart, 1);
  }
  rows.sort((a, b) => (a.depart_date < b.depart_date ? -1 : a.depart_date > b.depart_date ? 1 : a.product < b.product ? -1 : 1));
  return { rows, clearFrom };
}
