/** 되채우기 → 매일 모드로 넘기는 상태 파일 (--out/daily_state.json). */
import type { DayStats, Ev } from "./engine";

export interface DayState {
  /** 이 날 계획 중 다음에 넣을 번호 (시각 순). */
  next: number;
  total: number;
  finalized: boolean;
  stats: DayStats;
}

export interface DailyState {
  version: 1;
  seed: number;
  windowStart: string;
  windowEnd: string;
  cutoff: number;
  members: number;
  newMembers: number;
  staffId: string;
  days: Record<string, DayState>;
  queue: Ev[];
  /** 출발일을 90일 앞까지 늘린 마지막 날. */
  extendedFor: string | null;
  /** 넣던 중인 예약 (다시 켜면 실제로 들어갔는지 확인). */
  inflight: { key: string; at: number } | null;
  updatedAt: string;
}
