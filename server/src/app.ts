import { randomUUID } from "node:crypto";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import { checkDatabaseReady, getPoolStats, query } from "./db";
import {
  renderMetrics,
  updateArchiveManifestCounts,
  updateDbPoolStats,
  updateQueueCounts,
  updateReadiness,
  observeHttpRequest,
} from "./observability/metrics";
import { apiLogger } from "./observability/logger";
import { captureException } from "./observability/sentry";
import devicesRouter from "./routes/devices";
import installationsRouter from "./routes/installations";
import licitacionesRouter from "./routes/licitaciones";
import rubrosRouter from "./routes/rubros";

interface CountRow extends Record<string, unknown> {
  status: string;
  count: number | string;
}

async function loadQueueCounts(): Promise<{ status: string; count: number }[]> {
  const rows = await query<CountRow>(
    `SELECT status, COUNT(*)::int AS count
     FROM notification_deliveries
     GROUP BY status`
  );

  return rows.map((row) => ({
    status: row.status,
    count: Number(row.count),
  }));
}

async function loadArchiveManifestCounts(): Promise<{ status: string; count: number }[]> {
  try {
    const rows = await query<CountRow>(
      `SELECT status, COUNT(*)::int AS count
       FROM archive_exports
       GROUP BY status`
    );

    return rows.map((row) => ({
      status: row.status,
      count: Number(row.count),
    }));
  } catch {
    return [];
  }
}

function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction) {
  req.requestId = req.header("x-request-id") || randomUUID();
  res.setHeader("x-request-id", req.requestId);

  const startedAt = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    const route = req.route?.path
      ? `${req.baseUrl || ""}${req.route.path}`
      : req.path;

    observeHttpRequest(req.method, route, res.statusCode, durationMs);
    apiLogger.info("http_request_completed", {
      request_id: req.requestId,
      method: req.method,
      route,
      status_code: res.statusCode,
      duration_ms: durationMs,
    });
  });

  next();
}

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(requestLoggingMiddleware);

  app.get("/api/health/live", (_req, res) => {
    res.json({
      status: "ok",
      service: "api",
      env: process.env.NODE_ENV || "development",
      uptime_seconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/health/ready", async (_req, res) => {
    const readiness = await checkDatabaseReady();
    updateDbPoolStats(readiness.stats);
    updateReadiness(readiness.ok);

    const payload = {
      status: readiness.ok ? "ok" : "degraded",
      service: "api",
      db: {
        ok: readiness.ok,
        reason: readiness.reason ?? null,
        duration_ms: readiness.durationMs,
        pool: readiness.stats,
      },
      timestamp: new Date().toISOString(),
    };

    res.status(readiness.ok ? 200 : 503).json(payload);
  });

  app.get("/api/health", async (_req, res) => {
    const readiness = await checkDatabaseReady();
    updateDbPoolStats(readiness.stats);
    updateReadiness(readiness.ok);

    res.status(readiness.ok ? 200 : 503).json({
      status: readiness.ok ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      db: {
        ok: readiness.ok,
        reason: readiness.reason ?? null,
      },
    });
  });

  app.get("/api/metrics", async (_req, res, next) => {
    try {
      updateDbPoolStats(getPoolStats());
      updateQueueCounts(await loadQueueCounts());
      updateArchiveManifestCounts(await loadArchiveManifestCounts());
      const readiness = await checkDatabaseReady();
      updateReadiness(readiness.ok);

      res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
      res.send(await renderMetrics());
    } catch (error) {
      next(error);
    }
  });

  app.use("/api/installations", installationsRouter);
  app.use("/api/devices", devicesRouter);
  app.use("/api/licitaciones", licitacionesRouter);
  app.use("/api/rubros", rubrosRouter);

  app.use(
    (
      error: unknown,
      req: Request,
      res: Response,
      _next: NextFunction
    ) => {
      const requestId = req.requestId || randomUUID();
      const message =
        error instanceof Error ? error.message : "Unhandled API exception";

      captureException(error, {
        requestId,
        method: req.method,
        route: req.path,
        statusCode: 500,
      });

      apiLogger.error("api_unhandled_exception", {
        request_id: requestId,
        method: req.method,
        route: req.path,
        error_code: "api_unhandled_exception",
        error: error instanceof Error ? error : new Error(String(error)),
      });

      res.status(500).json({
        status: "error",
        message,
        requestId,
      });
    }
  );

  return app;
}
