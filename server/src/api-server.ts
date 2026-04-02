import type { Server } from "node:http";
import { createApp } from "./app";
import { apiLogger } from "./observability/logger";
import { initSentry } from "./observability/sentry";

const PORT = Number(process.env.PORT) || 3001;

export function startApiServer(): Server {
  initSentry("notichilec-api");

  const app = createApp();
  const server = app.listen(PORT, () => {
    apiLogger.info("api_server_started", {
      port: PORT,
      route: "/api/health/live",
    });
  });

  return server;
}
