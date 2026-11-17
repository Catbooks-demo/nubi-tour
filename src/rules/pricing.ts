import { diffDays } from "./time";

export interface DeparturePrices {
  price_adult: number;
  price_child: number;
  price_infant: number;
  single_supplement: number;
  deposit_per_person: number;
}

export interface Pax {
  adults: number;
  children: number;
  infants: number;
  single_rooms: number;
}

export interface QuoteLine {
  label: string;
  unit: number;
  qty: number;
  amount: number;
}

export interface Quote {
  total: number;
  seats: number;
  lines: QuoteLine[];
}

export const MAX_PAX = 9;

/** 인원 검사. 문제가 없으면 null, 있으면 손님에게 보여 줄 문장. */
export function validatePax(p: Pax): string | null {
  const ints = [p.adults, p.children, p.infants, p.single_rooms];
  if (ints.some((n) => !Number.isInteger(n) || n < 0)) return "인원은 0 이상의 정수로 넣어 주세요.";
  if (p.adults < 1) return "성인이 1명 이상 있어야 예약할 수 있어요.";
  if (p.infants > p.adults) return "유아는 성인 1명당 1명까지 함께 예약할 수 있어요.";
  if (p.adults + p.children + p.infants > MAX_PAX) return `한 번에 ${MAX_PAX}명까지 예약할 수 있어요.`;
  if (p.single_rooms > p.adults) return "싱글룸은 성인 수보다 많을 수 없어요.";
  return null;
}

/** 요금 계산. 유아는 좌석을 쓰지 않는다. */
export function quote(d: DeparturePrices, p: Pax): Quote {
  const lines: QuoteLine[] = [
    { label: "성인", unit: d.price_adult, qty: p.adults, amount: d.price_adult * p.adults },
  ];
  if (p.children) lines.push({ label: "아동", unit: d.price_child, qty: p.children, amount: d.price_child * p.children });
  if (p.infants) lines.push({ label: "유아", unit: d.price_infant, qty: p.infants, amount: d.price_infant * p.infants });
  if (p.single_rooms)
    lines.push({ label: "싱글룸 추가", unit: d.single_supplement, qty: p.single_rooms, amount: d.single_supplement * p.single_rooms });
  return { total: lines.reduce((s, l) => s + l.amount, 0), seats: p.adults + p.children, lines };
}

/** 출발일 기준 만 나이. */
export function ageOn(birth: string, on: string): number {
  const [by, bm, bd] = birth.split("-").map(Number);
  const [oy, om, od] = on.split("-").map(Number);
  let age = oy - by;
  if (om < bm || (om === bm && od < bd)) age--;
  return age;
}

export type TravelerType = "adult" | "child" | "infant";

/** 만 2세 미만 유아, 만 12세 미만 아동, 그 밖 성인 (출발일 기준). */
export function travelerType(birth: string, departureDate: string): TravelerType {
  const age = ageOn(birth, departureDate);
  if (age < 2) return "infant";
  if (age < 12) return "child";
  return "adult";
}

/** 생년월일 형식과 범위 확인 (미래 날짜·120세 초과 거부). */
export function validBirthDate(birth: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) return false;
  const [y, m, d] = birth.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return false;
  return diffDays(birth, today) >= 0 && ageOn(birth, today) <= 120;
}
