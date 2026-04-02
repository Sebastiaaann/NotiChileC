import { Pool, type PoolConfig, type QueryResult } from "pg";

let pool: Pool | null = null;

export interface PoolStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  maxConnections: number;
}

const DEFAULT_POOL_MAX = Number(process.env.DB_POOL_MAX) || 4;
const DEFAULT_IDLE_TIMEOUT_MS = Number(process.env.DB_IDLE_TIMEOUT_MS) || 30_000;
const DEFAULT_CONNECTION_TIMEOUT_MS =
  Number(process.env.DB_CONNECTION_TIMEOUT_MS) || 5_000;
const DEFAULT_READINESS_TIMEOUT_MS =
  Number(process.env.DB_READINESS_TIMEOUT_MS) || 1_500;

function getRuntimeConnectionString(): string {
  return (
    process.env.DATABASE_POOL_URL ||
    process.env.DATABASE_URL ||
    (() => {
      throw new Error("DATABASE_POOL_URL / DATABASE_URL no está configurada");
    })()
  );
}

export function getDirectConnectionString(): string {
  return (
    process.env.DATABASE_DIRECT_URL ||
    process.env.DATABASE_URL ||
    (() => {
      throw new Error("DATABASE_DIRECT_URL / DATABASE_URL no está configurada");
    })()
  );
}

function buildPoolConfig(connectionString: string, applicationName: string): PoolConfig {
  return {
    connectionString,
    max: DEFAULT_POOL_MAX,
    idleTimeoutMillis: DEFAULT_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: DEFAULT_CONNECTION_TIMEOUT_MS,
    maxUses: 7_500,
    allowExitOnIdle: false,
    application_name: applicationName,
  };
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(buildPoolConfig(getRuntimeConnectionString(), "notichilec-runtime"));
  }

  return pool;
}

export function createDirectPool(applicationName = "notichilec-direct"): Pool {
  return new Pool(buildPoolConfig(getDirectConnectionString(), applicationName));
}

export async function query<T extends Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await queryResult<T>(text, params);
  return result.rows;
}

export async function queryResult<T extends Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params);
}

export async function queryOne<T extends Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export function getPoolStats(): PoolStats {
  const currentPool = getPool();
  return {
    totalCount: currentPool.totalCount,
    idleCount: currentPool.idleCount,
    waitingCount: currentPool.waitingCount,
    maxConnections: DEFAULT_POOL_MAX,
  };
}

export async function checkDatabaseReady(timeoutMs = DEFAULT_READINESS_TIMEOUT_MS): Promise<{
  ok: boolean;
  durationMs: number;
  reason?: string;
  stats: PoolStats;
}> {
  const stats = getPoolStats();
  const startedAt = Date.now();

  if (stats.waitingCount > 0 && stats.totalCount >= stats.maxConnections) {
    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      reason: "pool_saturated",
      stats,
    };
  }

  try {
    await Promise.race([
      queryOne<{ ok: number }>("SELECT 1 AS ok"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("db_readiness_timeout")), timeoutMs)
      ),
    ]);

    return {
      ok: true,
      durationMs: Date.now() - startedAt,
      stats: getPoolStats(),
    };
  } catch (error) {
    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      reason: error instanceof Error ? error.message : "db_readiness_failed",
      stats: getPoolStats(),
    };
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
