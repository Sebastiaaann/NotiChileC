import { Buffer } from "node:buffer";
import { Router, type Request, type Response } from "express";
import { query, queryOne } from "../db";
import { apiLogger } from "../observability/logger";
import { captureException } from "../observability/sentry";

const router = Router();
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const DEFAULT_WINDOW_DAYS = 90;
const MAX_WINDOW_DAYS = 365;

interface LicitacionRow extends Record<string, unknown> {
  id: string;
  codigo_externo: string;
  nombre: string;
  organismo_nombre: string | null;
  tipo: string | null;
  monto_estimado: string | null;
  monto_label: string | null;
  moneda: string;
  fecha_publicacion: string | null;
  fecha_cierre: string | null;
  estado: string;
  url: string | null;
  region: string | null;
  categoria: string;
  created_at: string;
}

interface LicitacionesFilters {
  rubro?: string;
  tipo?: string;
  region?: string;
  montoMin?: number;
  montoMax?: number;
}

interface FeedCursor {
  createdAt: string;
  id: string;
}

function normalizeStringFilter(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNumberFilter(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function readFilters(req: Request): LicitacionesFilters {
  return {
    rubro: normalizeStringFilter(req.query.rubro),
    tipo: normalizeStringFilter(req.query.tipo),
    region: normalizeStringFilter(req.query.region),
    montoMin: normalizeNumberFilter(req.query.montoMin),
    montoMax: normalizeNumberFilter(req.query.montoMax),
  };
}

function readLimit(req: Request): number {
  return Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit) || DEFAULT_LIMIT));
}

function readWindowDays(req: Request): number {
  return Math.min(
    MAX_WINDOW_DAYS,
    Math.max(1, Number(req.query.windowDays) || DEFAULT_WINDOW_DAYS)
  );
}

function decodeCursor(value: unknown): FeedCursor | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;

  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as Partial<FeedCursor>;

    if (
      typeof parsed.createdAt !== "string" ||
      typeof parsed.id !== "string" ||
      Number.isNaN(Date.parse(parsed.createdAt)) ||
      parsed.id.trim().length === 0
    ) {
      return null;
    }

    return {
      createdAt: parsed.createdAt,
      id: parsed.id,
    };
  } catch {
    return null;
  }
}

function encodeCursor(row: Pick<LicitacionRow, "created_at" | "id">): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: row.created_at,
      id: row.id,
    }),
    "utf8"
  ).toString("base64url");
}

function buildWhereClause(filters: LicitacionesFilters, windowStart: Date, cursor: FeedCursor | null) {
  let whereClause = "WHERE created_at >= $1";
  const params: unknown[] = [windowStart.toISOString()];
  let paramIndex = 2;

  if (filters.rubro) {
    whereClause += ` AND rubro_code LIKE $${paramIndex}`;
    params.push(`${filters.rubro}%`);
    paramIndex++;
  }

  if (filters.tipo) {
    whereClause += ` AND tipo = $${paramIndex}`;
    params.push(filters.tipo);
    paramIndex++;
  }

  if (filters.region) {
    whereClause += ` AND region = $${paramIndex}`;
    params.push(filters.region);
    paramIndex++;
  }

  if (filters.montoMin !== undefined) {
    whereClause += ` AND monto_estimado IS NOT NULL AND monto_estimado >= $${paramIndex}`;
    params.push(filters.montoMin);
    paramIndex++;
  }

  if (filters.montoMax !== undefined) {
    whereClause += ` AND monto_estimado IS NOT NULL AND monto_estimado <= $${paramIndex}`;
    params.push(filters.montoMax);
    paramIndex++;
  }

  if (cursor) {
    whereClause += ` AND (created_at, id) < ($${paramIndex}::timestamptz, $${paramIndex + 1})`;
    params.push(cursor.createdAt, cursor.id);
    paramIndex += 2;
  }

  return { whereClause, params, paramIndex };
}

/**
 * GET /api/licitaciones
 * Lista las licitaciones más recientes usando cursor pagination.
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const limit = readLimit(req);
    const windowDays = readWindowDays(req);
    const cursor = decodeCursor(req.query.cursor);

    if (req.query.cursor && !cursor) {
      res.status(400).json({ error: "Cursor inválido" });
      return;
    }

    const filters = readFilters(req);
    const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const startedAt = Date.now();

    const { whereClause, params, paramIndex } = buildWhereClause(
      filters,
      windowStart,
      cursor
    );

    params.push(limit + 1);

    const rows = await query<LicitacionRow>(
      `SELECT id, codigo_externo, nombre, organismo_nombre, tipo,
              monto_estimado, monto_label, moneda, fecha_publicacion, fecha_cierre,
              estado, url, region, categoria, created_at
       FROM licitaciones
       ${whereClause}
       ORDER BY created_at DESC, id DESC
       LIMIT $${paramIndex}`,
      params
    );

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? encodeCursor(pageRows[pageRows.length - 1]!) : null;

    apiLogger.info("licitaciones_feed_request", {
      limit,
      hasMore,
      returnedRows: pageRows.length,
      windowDays,
      durationMs: Date.now() - startedAt,
    });

    res.json({
      data: pageRows.map(formatLicitacion),
      pageInfo: {
        limit,
        hasMore,
        nextCursor,
        windowDays,
        windowStart: windowStart.toISOString(),
      },
    });
  } catch (error) {
    captureException(error, { route: "/api/licitaciones", method: "GET" });
    apiLogger.error("licitaciones_list_failed", {
      route: "/api/licitaciones",
      error_code: "licitaciones_list_failed",
      error: error instanceof Error ? error : new Error(String(error)),
    });
    res.status(500).json({ error: "Error interno" });
  }
});

router.get("/regions", async (req: Request, res: Response) => {
  try {
    const windowDays = readWindowDays(req);
    const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const rows = await query<{ region: string }>(
      `SELECT DISTINCT region
       FROM licitaciones
       WHERE created_at >= $1
         AND region IS NOT NULL
         AND TRIM(region) <> ''
       ORDER BY region ASC`,
      [windowStart.toISOString()]
    );

    res.json({
      data: rows.map((row) => ({ name: row.region })),
    });
  } catch (error) {
    captureException(error, { route: "/api/licitaciones/regions", method: "GET" });
    apiLogger.error("licitaciones_regions_failed", {
      route: "/api/licitaciones/regions",
      error_code: "licitaciones_regions_failed",
      error: error instanceof Error ? error : new Error(String(error)),
    });
    res.status(500).json({ error: "Error interno" });
  }
});

/**
 * GET /api/licitaciones/:id
 * Detalle de una licitación.
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const row = await queryOne<LicitacionRow>(
      `SELECT id, codigo_externo, nombre, organismo_nombre, tipo,
              monto_estimado, monto_label, moneda, fecha_publicacion, fecha_cierre,
              estado, url, region, categoria, created_at
       FROM licitaciones
       WHERE id = $1 OR codigo_externo = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [req.params.id]
    );

    if (!row) {
      res.status(404).json({ error: "Licitación no encontrada" });
      return;
    }

    res.json({ data: formatLicitacion(row) });
  } catch (error) {
    captureException(error, { route: "/api/licitaciones/:id", method: "GET" });
    apiLogger.error("licitacion_detail_failed", {
      route: "/api/licitaciones/:id",
      error_code: "licitacion_detail_failed",
      error: error instanceof Error ? error : new Error(String(error)),
    });
    res.status(500).json({ error: "Error interno" });
  }
});

function formatLicitacion(row: LicitacionRow) {
  const monto = row.monto_estimado ? Number(row.monto_estimado) : null;

  return {
    id: row.id,
    codigoExterno: row.codigo_externo,
    nombre: row.nombre,
    organismoNombre: row.organismo_nombre,
    tipo: row.tipo,
    montoEstimado: monto,
    montoLabel: monto
      ? new Intl.NumberFormat("es-CL", {
          style: "currency",
          currency: row.moneda,
          maximumFractionDigits: 0,
        }).format(monto)
      : row.monto_label ?? null,
    moneda: row.moneda,
    fechaPublicacion: row.fecha_publicacion,
    fechaCierre: row.fecha_cierre,
    estado: row.estado,
    url: row.url,
    region: row.region,
    categoria: row.categoria,
    createdAt: row.created_at,
  };
}

export default router;
