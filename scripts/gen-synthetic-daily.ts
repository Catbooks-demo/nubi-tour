/**
 * 누비투어 가상 예약 매일 모드 (되채우기 뒤 계속 도는 프로세스). 앱과 같은 PC에서 같은 DATABASE_URL로.
 *
 *   npm run synth:daily                         # 10분마다
 *   npm run synth:daily -- --once               # 한 차례만
 *   --out DIR  --interval-min 10  --max-late-h 6 (이보다 늦은 계획 예약은 넣지 않고 놓친 것으로 센다)
 */
import { main } from "./gen-synthetic";

main(["--daily", ...process.argv.slice(2)])
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { db } = await import("../src/server/db");
    await db.$disconnect();
  });
