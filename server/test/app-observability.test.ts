import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  queryMock,
  checkDatabaseReadyMock,
  getPoolStatsMock,
} = vi.hoisted(() => ({
  queryMock: vi.fn(),
  checkDatabaseReadyMock: vi.fn(),
  getPoolStatsMock: vi.fn(),
}));

vi.mock("../src/db", () => ({
  query: queryMock,
  queryOne: vi.fn(),
  queryResult: vi.fn(),
  getPoolStats: getPoolStatsMock,
  checkDatabaseReady: checkDatabaseReadyMock,
}));

describe("app observability", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    checkDatabaseReadyMock.mockResolvedValue({
      ok: true,
      durationMs: 12,
      stats: {
        totalCount: 2,
        idleCount: 1,
        waitingCount: 0,
        maxConnections: 4,
      },
    });
    getPoolStatsMock.mockReturnValue({
      totalCount: 2,
      idleCount: 1,
      waitingCount: 0,
      maxConnections: 4,
    });
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM notification_deliveries")) {
        return [{ status: "pending", count: 3 }];
      }
      if (sql.includes("FROM archive_exports")) {
        return [{ status: "verified", count: 2 }];
      }
      return [];
    });
  });

  it("expone liveness sin tocar DB", async () => {
    const { createApp } = await import("../src/app");
    const response = await request(createApp()).get("/api/health/live");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.headers["x-request-id"]).toBeTruthy();
    expect(checkDatabaseReadyMock).not.toHaveBeenCalled();
  });

  it("expone readiness con estado de DB/pool", async () => {
    const { createApp } = await import("../src/app");
    const response = await request(createApp()).get("/api/health/ready");

    expect(response.status).toBe(200);
    expect(response.body.db.ok).toBe(true);
    expect(response.body.db.pool.maxConnections).toBe(4);
  });

  it("mantiene alias /api/health y devuelve 503 cuando readiness falla", async () => {
    checkDatabaseReadyMock.mockResolvedValue({
      ok: false,
      durationMs: 100,
      reason: "pool_saturated",
      stats: {
        totalCount: 4,
        idleCount: 0,
        waitingCount: 3,
        maxConnections: 4,
      },
    });

    const { createApp } = await import("../src/app");
    const response = await request(createApp()).get("/api/health");

    expect(response.status).toBe(503);
    expect(response.body.db.reason).toBe("pool_saturated");
  });

  it("expone métricas Prometheus", async () => {
    const { createApp } = await import("../src/app");
    const response = await request(createApp()).get("/api/metrics");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.text).toContain("notichilec_http_requests_total");
    expect(response.text).toContain("notichilec_notification_queue_items");
    expect(response.text).toContain("notichilec_archive_manifest_items");
  });
});
