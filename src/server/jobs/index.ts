import { log } from "../log";
import { runJobsOnce } from "./tasks";

const EVERY_MS = 5 * 60_000;
let started = false;

/** 앱 안 스케줄러: 5분마다 주기 작업. 여러 앱이 떠도 DB 잠금으로 한 번에 하나만 돈다. */
export function startScheduler(): void {
  if (started) return;
  started = true;
  const tick = async () => {
    try {
      const r = await runJobsOnce();
      if (r.ran && (r.expired || r.confirmed || r.departed || r.completed || r.balanceReminders)) log.info("주기 작업", { ...r });
    } catch (e) {
      log.error("주기 작업 실패", { error: e instanceof Error ? e.message : String(e) });
    }
  };
  setTimeout(tick, 10_000).unref?.();
  setInterval(tick, EVERY_MS).unref?.();
  log.info("주기 작업 시작", { every_min: EVERY_MS / 60_000 });
}

export { cancelDeparture, runJobsOnce } from "./tasks";
