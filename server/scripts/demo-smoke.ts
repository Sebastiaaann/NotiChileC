import "./load-demo-env";
import { createDirectPool } from "../src/db";
import { workerLogger } from "../src/observability/logger";

const API_URL = process.env.DEMO_API_URL || `http://localhost:${process.env.PORT || 3001}`;

async function assertOk(path: string) {
  const response = await fetch(`${API_URL}${path}`);
  if (!response.ok) {
    throw new Error(`demo_smoke_failed:${path}:${response.status}`);
  }
  return response.text();
}

async function main() {
  const live = await assertOk("/api/health/live");
  const ready = await assertOk("/api/health/ready");
  const metrics = await assertOk("/api/metrics");
  const feed = await fetch(`${API_URL}/api/licitaciones?limit=5&windowDays=90`);
  if (!feed.ok) {
    throw new Error(`demo_feed_failed:${feed.status}`);
  }
  const feedJson = (await feed.json()) as {
    data?: unknown[];
    pageInfo?: { hasMore?: boolean };
  };

  const directPool = createDirectPool("notichilec-demo-smoke");
  try {
    const result = await directPool.query<{
      installation_count: number | string;
      pending_count: number | string;
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM device_installations WHERE active = TRUE) AS installation_count,
         (SELECT COUNT(*)::int FROM notification_deliveries WHERE status IN ('pending', 'retryable')) AS pending_count`
    );

    const row = result.rows[0];
    workerLogger.info("demo_smoke_completed", {
      job: "demo_smoke",
      api_url: API_URL,
      live_length: live.length,
      ready_length: ready.length,
      metrics_length: metrics.length,
      feed_count: feedJson.data?.length ?? 0,
      has_more: feedJson.pageInfo?.hasMore ?? false,
      installation_count: Number(row?.installation_count ?? 0),
      pending_count: Number(row?.pending_count ?? 0),
    });
  } finally {
    await directPool.end();
  }
}

main().catch((error) => {
  workerLogger.error("demo_smoke_failed", {
    job: "demo_smoke",
    error_code: "demo_smoke_failed",
    error: error instanceof Error ? error : new Error(String(error)),
  });
  process.exit(1);
});
