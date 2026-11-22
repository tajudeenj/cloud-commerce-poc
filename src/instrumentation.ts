export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { env } = await import("@/lib/env");
  const e = env();
  if (!e.WORKER_ENABLED) return;
  const { startWorker } = await import("@/lib/services/worker");
  startWorker(e.WORKER_INTERVAL_MS);
}
