/** 미리보기(--dry-run)와 되채우기가 같이 쓰는 계획. DB를 건드리지 않는다. */
import { kstDate } from "../../src/rules/time";
import { buildModel, type DayPlan, type Model, PARTY_BUCKETS, planDay, REGION_CODES, windowDays } from "./model";

const MIN = 60_000;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** 계획만 (DB 없이): 미리보기와 정답지가 같은 함수를 쓴다. */
export function planWindow(seed: number, now: Date, size: { members?: number; newMembers?: number } = {}) {
  const today = kstDate(now);
  const cutoff = now.getTime() - MIN;
  const model = buildModel({ seed, windowEnd: today, cutoff, ...size });
  const plans = windowDays(model).map((d) => planDay(model, d));
  return { today, cutoff, model, plans };
}

export function planSummary(model: Model, plans: DayPlan[], cutoff: number) {
  const intents = plans.flatMap((p) => p.intents).filter((i) => i.t <= cutoff);
  const byRegion = Object.fromEntries(REGION_CODES.map((r) => [r, intents.filter((i) => i.region === r).length]));
  const sizes = [0, 0, 0, 0];
  let travelers = 0;
  for (const i of intents) {
    const n = i.travelers.length;
    travelers += n;
    sizes[n === 1 ? 0 : n === 2 ? 1 : n <= 4 ? 2 : 3]++;
  }
  return {
    window: { start: model.windowStart, end: model.windowEnd },
    members: model.members.length,
    joined_in_window: model.members.filter((m) => m.joinedInWindow).length,
    planned_bookings: intents.length,
    per_day: Math.round((intents.length / plans.length) * 10) / 10,
    guest_share: round3(intents.filter((i) => i.member === null).length / Math.max(1, intents.length)),
    travelers,
    by_region: byRegion,
    party_mix: Object.fromEntries(PARTY_BUCKETS.map((b, j) => [b, round3(sizes[j] / Math.max(1, intents.length))])),
  };
}

