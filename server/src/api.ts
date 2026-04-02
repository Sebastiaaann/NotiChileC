import "dotenv/config";
import { closePool } from "./db";
import { apiLogger } from "./observability/logger";
import { flushSentry, initSentry } from "./observability/sentry";
import { startApiServer } from "./api-server";

export function startApiProcess() {
  initSentry("notichilec-api");
  return startApiServer();
}

if (!process.env.VITEST) {
  const server = startApiProcess();

  const shutdown = async () => {
    apiLogger.info("api_shutdown_requested");
    server.close();
    await closePool();
    await flushSentry();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
