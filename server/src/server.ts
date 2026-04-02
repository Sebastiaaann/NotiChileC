import "dotenv/config";
import { closePool } from "./db";
import { startApiServer } from "./api-server";
import { combinedLogger } from "./observability/logger";
import { flushSentry, initSentry } from "./observability/sentry";
import { startWorkerScheduler } from "./worker-runtime";

export function startCombinedProcess() {
  initSentry("notichilec-combined");
  const server = startApiServer();
  const workerTask = startWorkerScheduler();

  return { server, workerTask };
}

if (!process.env.VITEST) {
  const { server, workerTask } = startCombinedProcess();

  const shutdown = async () => {
    combinedLogger.info("combined_shutdown_requested");
    workerTask.stop();
    server.close();
    await closePool();
    await flushSentry();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
