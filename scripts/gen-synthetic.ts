/**
 * 누비투어 가상 예약 넣기 (AXcellent 연결 시험용 데이터). 설계: "누비투어 가상 예약" 문서(2026-11-18).
 *
 *   npm run synth -- --dry-run                 # 계획만 보기 (DB·파일을 건드리지 않음)
 *   npm run synth                              # 되채우기: 예약한 날 기준 지난 60일
 *   npm run synth -- --replace                 # 가상 데이터만 지우고(한 트랜잭션) 다시 넣기
 *   npm run synth -- --daily                   # = npm run synth:daily (매일 모드)
 *
 *   --seed N        시드 (기본 20261118). 같은 시드면 같은 회원·같은 계획
 *   --out DIR       정답지·회원 표·매일 모드 상태 (기본 ./synthetic-out, .gitignore. 커밋 금지)
 *   --force         앱의 주기 작업이 최근에 돌았어도 진행 (권하지 않음)
 *
 * DATABASE_URL이 가리키는 DB에 쓴다. 되채우기 동안은 앱을 멈추거나 JOBS_ENABLED=false로 둔다
 * (지난 시각으로 처리하는 동안 앱의 주기 작업이 지금 시각으로 끼어들면 안 된다).
 */
import { DEFAULT_SEED } from "./synthetic/model";
import { resolveOut } from "./synthetic/outdir";

export interface Args {
  seed: number;
  out?: string;
  dryRun: boolean;
  replace: boolean;
  force: boolean;
  daily: boolean;
  once: boolean;
  intervalMin: number;
  maxLateH: number;
}

export function parseArgs(argv: string[]): Args {
  const a: Args = { seed: DEFAULT_SEED, dryRun: false, replace: false, force: false, daily: false, once: false, intervalMin: 10, maxLateH: 6 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${k} 뒤에 값이 필요해요`);
      return v;
    };
    if (k === "--seed") a.seed = Number(val());
    else if (k === "--out") a.out = val();
    else if (k === "--dry-run") a.dryRun = true;
    else if (k === "--replace") a.replace = true;
    else if (k === "--force") a.force = true;
    else if (k === "--daily") a.daily = true;
    else if (k === "--once") a.once = true;
    else if (k === "--interval-min") a.intervalMin = Number(val());
    else if (k === "--max-late-h") a.maxLateH = Number(val());
    else throw new Error(`모르는 옵션: ${k}`);
  }
  if (!Number.isInteger(a.seed)) throw new Error("--seed는 정수예요");
  if (!(a.intervalMin > 0)) throw new Error("--interval-min은 0보다 커야 해요");
  return a;
}

const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

/** 서버 함수를 불러오기 전에: 가상 결제는 모의 결제로만 (이 프로세스에서는 토스 키를 비운다). */
function mockPaymentsOnly(): void {
  process.env.TOSS_CLIENT_KEY = "";
  process.env.TOSS_SECRET_KEY = "";
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  if (args.daily) {
    const out = resolveOut(args.out);
    mockPaymentsOnly();
    const { runDaily } = await import("./synthetic/daily");
    await runDaily({ out, intervalMin: args.intervalMin, once: args.once, maxLateH: args.maxLateH, log });
    return;
  }
  if (args.dryRun) {
    const { planSummary, planWindow } = await import("./synthetic/preview");
    const { model, plans, cutoff } = planWindow(args.seed, new Date());
    console.log(JSON.stringify(planSummary(model, plans, cutoff), null, 2));
    log("미리보기만 했어요. DB와 파일은 그대로예요.");
    return;
  }
  const out = resolveOut(args.out);
  mockPaymentsOnly();
  const { runBackfill } = await import("./synthetic/backfill");
  await runBackfill({ seed: args.seed, out, replace: args.replace, force: args.force, log });
}

const invoked = process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/gen-synthetic.ts");
if (invoked) {
  main()
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (process.argv.includes("--dry-run")) return;
      const { db } = await import("../src/server/db");
      await db.$disconnect();
    });
}
