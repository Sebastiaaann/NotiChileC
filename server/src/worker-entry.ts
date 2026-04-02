import "dotenv/config";
import { closePool } from "./db";
import { workerLogger } from "./observability/logger";
import { flushSentry, initSentry } from "./observability/sentry";
import { executeWorker, startWorkerScheduler } from "./worker-runtime";

interface WorkerEntryOptions {
  argv?: string[];
  exitOnFinish?: boolean;
}

export async function runWorkerEntry(options: WorkerEntryOptions = {}) {
  initSentry("notichilec-worker");

  const argv = options.argv ?? process.argv;
  const exitOnFinish = options.exitOnFinish ?? true;

  if (argv.includes("--once")) {
    workerLogger.info("worker_once_requested");
    await executeWorker();
    await closePool();
    await flushSentry();
    if (exitOnFinish) {
      process.exit(0);
    }
    return;
  }

  startWorkerScheduler();
}

export const shutdownWorkerEntry = async () => {
  workerLogger.info("worker_shutdown_requested");
  await closePool();
  await flushSentry();
  process.exit(0);
};

process.on("SIGINT", () => void shutdownWorkerEntry());
process.on("SIGTERM", () => void shutdownWorkerEntry());

if (!process.env.VITEST) {
  void runWorkerEntry();
}
