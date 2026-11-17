/** 서버가 켜질 때 한 번: 설정 검사(토스 live 키 거부)와 주기 작업 시작. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getEnv } = await import("./server/env");
  const env = getEnv();
  if (env.JOBS_ENABLED) {
    const { startScheduler } = await import("./server/jobs");
    startScheduler();
  }
}
