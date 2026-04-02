import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";
import type { PoolStats } from "../db";
import type { WorkerResult } from "../worker";

const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: "notichilec_" });

const httpRequestsTotal = new Counter({
  name: "notichilec_http_requests_total",
  help: "Total de requests HTTP",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [registry],
});

const httpRequestDurationSeconds = new Histogram({
  name: "notichilec_http_request_duration_seconds",
  help: "Duración de requests HTTP",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

const workerRunsTotal = new Counter({
  name: "notichilec_worker_runs_total",
  help: "Cantidad de corridas de worker por job/resultado",
  labelNames: ["job", "status"] as const,
  registers: [registry],
});

const workerRunDurationSeconds = new Histogram({
  name: "notichilec_worker_run_duration_seconds",
  help: "Duración de corridas de worker por job/resultado",
  labelNames: ["job", "status"] as const,
  buckets: [0.05, 0.1, 0.5, 1, 2, 5, 10, 30, 60, 120],
  registers: [registry],
});

const notificationOutcomesTotal = new Counter({
  name: "notichilec_notification_outcomes_total",
  help: "Resultados de delivery/notificaciones por job",
  labelNames: ["job", "outcome"] as const,
  registers: [registry],
});

const archiveExportsTotal = new Counter({
  name: "notichilec_archive_exports_total",
  help: "Resultados de exportaciones a storage frío",
  labelNames: ["entity", "status"] as const,
  registers: [registry],
});

const dbPoolGauge = new Gauge({
  name: "notichilec_db_pool_clients",
  help: "Estado del pool de PostgreSQL",
  labelNames: ["state"] as const,
  registers: [registry],
});

const readinessGauge = new Gauge({
  name: "notichilec_db_readiness",
  help: "1 si la DB/pool está lista, 0 en caso contrario",
  registers: [registry],
});

const queueGauge = new Gauge({
  name: "notichilec_notification_queue_items",
  help: "Tamaño actual de la cola notification_deliveries por status",
  labelNames: ["status"] as const,
  registers: [registry],
});

const archiveManifestGauge = new Gauge({
  name: "notichilec_archive_manifest_items",
  help: "Cantidad de filas en archive_exports por estado",
  labelNames: ["status"] as const,
  registers: [registry],
});

export interface QueueCountRow {
  status: string;
  count: number;
}

export function observeHttpRequest(
  method: string,
  route: string,
  statusCode: number,
  durationMs: number
): void {
  const labels = {
    method,
    route,
    status_code: String(statusCode),
  };

  httpRequestsTotal.inc(labels);
  httpRequestDurationSeconds.observe(labels, durationMs / 1_000);
}

export function observeWorkerRun(
  job: string,
  status: "success" | "error",
  durationMs: number,
  result: WorkerResult
): void {
  workerRunsTotal.inc({ job, status });
  workerRunDurationSeconds.observe({ job, status }, durationMs / 1_000);

  notificationOutcomesTotal.inc({ job, outcome: "sent" }, result.notificationsSent);
  notificationOutcomesTotal.inc(
    { job, outcome: "retryable" },
    result.notificationsRetryable
  );
  notificationOutcomesTotal.inc({ job, outcome: "failed" }, result.notificationsFailed);
  notificationOutcomesTotal.inc(
    { job, outcome: "invalid" },
    result.notificationsInvalidated
  );
}

export function observeArchiveExport(
  entity: string,
  status: "exported" | "verified" | "failed" | "dropped",
  count = 1
): void {
  archiveExportsTotal.inc({ entity, status }, count);
}

export function updateDbPoolStats(stats: PoolStats): void {
  dbPoolGauge.set({ state: "total" }, stats.totalCount);
  dbPoolGauge.set({ state: "idle" }, stats.idleCount);
  dbPoolGauge.set({ state: "waiting" }, stats.waitingCount);
  dbPoolGauge.set({ state: "max" }, stats.maxConnections);
}

export function updateReadiness(ok: boolean): void {
  readinessGauge.set(ok ? 1 : 0);
}

export function updateQueueCounts(rows: QueueCountRow[]): void {
  queueGauge.reset();
  rows.forEach((row) => {
    queueGauge.set({ status: row.status }, row.count);
  });
}

export function updateArchiveManifestCounts(rows: QueueCountRow[]): void {
  archiveManifestGauge.reset();
  rows.forEach((row) => {
    archiveManifestGauge.set({ status: row.status }, row.count);
  });
}

export async function renderMetrics(): Promise<string> {
  return registry.metrics();
}

export function resetMetricsForTests(): void {
  registry.resetMetrics();
}
