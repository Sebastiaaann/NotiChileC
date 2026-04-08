import { Buffer } from "node:buffer";
import { Router, type Request, type Response } from "express";
import { query, queryOne } from "../db";
import {
  DEFAULT_FEED_SORT_MODE,
  isFeedSortMode,
  type FeedSortMode,
} from "../feed-sort";
import { apiLogger } from "../observability/logger";
import { captureException } from "../observability/sentry";

const router = Router();
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const DEFAULT_WINDOW_DAYS = 90;
const MAX_WINDOW_DAYS = 365;
const FAR_PAST_RANK = -253402300799999;

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
  source_rank: number | null;
  created_at: string;
}

interface LicitacionesFilters {
  rubro?: string;
  tipo?: string;
  region?: string;
  montoMin?: number;
  montoMax?: number;
}

type FeedCursor =
  | {
      mode: "latest_published";
      primaryDate: string;
      rankSort: number;
      createdAt: string;
      id: string;
    }
  | {
      mode: "most_relevant";
      relevanceBucket: number;
      montoRank: number;
      primaryDate: string;
      createdAt: string;
      id: string;
    }
  | {
      mode: "closing_soon";
      activeBucket: number;
      closingRank: number;
      primaryDate: string;
      createdAt: string;
      id: string;
    };

interface BuildWhereResult {
  whereClause: string;
  params: unknown[];
  paramIndex: number;
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

function readSortMode(req: Request): FeedSortMode {
  return isFeedSortMode(req.query.sortMode)
    ? req.query.sortMode
    : DEFAULT_FEED_SORT_MODE;
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

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function decodeCursor(value: unknown): FeedCursor | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;

  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as Partial<FeedCursor>;

    if (!parsed || !isFeedSortMode(parsed.mode) || typeof parsed.id !== "string") {
      return null;
    }

    if (parsed.mode === "latest_published") {
      if (
        !isIsoDate(parsed.primaryDate) ||
        !isFiniteNumber(parsed.rankSort) ||
        !isIsoDate(parsed.createdAt)
      ) {
        return null;
      }

      return {
        mode: parsed.mode,
        primaryDate: parsed.primaryDate,
        rankSort: parsed.rankSort,
        createdAt: parsed.createdAt,
        id: parsed.id,
      };
    }

    if (parsed.mode === "most_relevant") {
      if (
        !isFiniteNumber(parsed.relevanceBucket) ||
        !isFiniteNumber(parsed.montoRank) ||
        !isIsoDate(parsed.primaryDate) ||
        !isIsoDate(parsed.createdAt)
      ) {
        return null;
      }

      return {
        mode: parsed.mode,
        relevanceBucket: parsed.relevanceBucket,
        montoRank: parsed.montoRank,
        primaryDate: parsed.primaryDate,
        createdAt: parsed.createdAt,
        id: parsed.id,
      };
    }

    if (
      !isFiniteNumber(parsed.activeBucket) ||
      !isFiniteNumber(parsed.closingRank) ||
      !isIsoDate(parsed.primaryDate) ||
      !isIsoDate(parsed.createdAt)
    ) {
      return null;
    }

    return {
      mode: parsed.mode,
      activeBucket: parsed.activeBucket,
      closingRank: parsed.closingRank,
      primaryDate: parsed.primaryDate,
      createdAt: parsed.createdAt,
      id: parsed.id,
    };
  } catch {
    return null;
  }
}

function getPrimaryDate(row: Pick<LicitacionRow, "fecha_publicacion" | "created_at">): string {
  return row.fecha_publicacion ?? row.created_at;
}

function getRankSort(row: Pick<LicitacionRow, "source_rank">): number {
  return row.source_rank === null ? -2147483647 : -row.source_rank;
}

function getRelevanceBucket(row: Pick<LicitacionRow, "estado" | "fecha_cierre">): number {
  if (row.estado !== "Publicada") return 0;
  if (!row.fecha_cierre) return 1;
  return new Date(row.fecha_cierre).getTime() >= Date.now() ? 1 : 0;
}

function getMontoRank(row: Pick<LicitacionRow, "monto_estimado">): number {
  return row.monto_estimado ? Number(row.monto_estimado) : 0;
}

function getActiveBucket(row: Pick<LicitacionRow, "estado" | "fecha_cierre">): number {
  return getRelevanceBucket(row);
}

function getClosingRank(row: Pick<LicitacionRow, "estado" | "fecha_cierre">): number {
  if (getActiveBucket(row) !== 1) return FAR_PAST_RANK;
  if (!row.fecha_cierre) return FAR_PAST_RANK;

  const closingAt = new Date(row.fecha_cierre).getTime();
  return Number.isFinite(closingAt) ? -closingAt : FAR_PAST_RANK;
}

function encodeCursor(row: LicitacionRow, sortMode: FeedSortMode): string {
  const primaryDate = getPrimaryDate(row);

  const payload: FeedCursor =
    sortMode === "closing_soon"
      ? {
          mode: sortMode,
          activeBucket: getActiveBucket(row),
          closingRank: getClosingRank(row),
          primaryDate,
          createdAt: row.created_at,
          id: row.id,
        }
      : sortMode === "most_relevant"
        ? {
            mode: sortMode,
            relevanceBucket: getRelevanceBucket(row),
            montoRank: getMontoRank(row),
            primaryDate,
            createdAt: row.created_at,
            id: row.id,
          }
        : {
            mode: sortMode,
            primaryDate,
            rankSort: getRankSort(row),
            createdAt: row.created_at,
            id: row.id,
          };

  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function appendBaseFilters(
  filters: LicitacionesFilters,
  params: unknown[],
  whereParts: string[]
) {
  if (filters.rubro) {
    params.push(`${filters.rubro}%`);
    whereParts.push(`rubro_code LIKE $${params.length}`);
  }

  if (filters.tipo) {
    params.push(filters.tipo);
    whereParts.push(`tipo = $${params.length}`);
  }

  if (filters.region) {
    params.push(filters.region);
    whereParts.push(`region = $${params.length}`);
  }

  if (filters.montoMin !== undefined) {
    params.push(filters.montoMin);
    whereParts.push(`monto_estimado IS NOT NULL AND monto_estimado >= $${params.length}`);
  }

  if (filters.montoMax !== undefined) {
    params.push(filters.montoMax);
    whereParts.push(`monto_estimado IS NOT NULL AND monto_estimado <= $${params.length}`);
  }
}

function buildLatestPublishedWhere(
  filters: LicitacionesFilters,
  windowStart: Date,
  cursor: FeedCursor | null
): BuildWhereResult {
  const params: unknown[] = [windowStart.toISOString()];
  const whereParts = ["COALESCE(fecha_publicacion, created_at) >= $1"];

  appendBaseFilters(filters, params, whereParts);

  if (cursor) {
    if (cursor.mode !== "latest_published") {
      throw new Error("Cursor no coincide con latest_published");
    }

    params.push(cursor.primaryDate, cursor.createdAt, cursor.id);
    params.splice(params.length - 2, 0, cursor.rankSort);
    const start = params.length - 3;
    whereParts.push(
      `(COALESCE(fecha_publicacion, created_at),
        COALESCE(-source_rank, -2147483647),
        created_at,
        id) < ($${start}::timestamptz, $${start + 1}, $${start + 2}::timestamptz, $${start + 3})`
    );
  }

  return {
    whereClause: `WHERE ${whereParts.join(" AND ")}`,
    params,
    paramIndex: params.length + 1,
  };
}

function buildMostRelevantWhere(
  filters: LicitacionesFilters,
  windowStart: Date,
  cursor: FeedCursor | null
): BuildWhereResult {
  const params: unknown[] = [windowStart.toISOString()];
  const whereParts = ["COALESCE(fecha_publicacion, created_at) >= $1"];

  appendBaseFilters(filters, params, whereParts);

  if (cursor) {
    if (cursor.mode !== "most_relevant") {
      throw new Error("Cursor no coincide con most_relevant");
    }

    params.push(
      cursor.relevanceBucket,
      cursor.montoRank,
      cursor.primaryDate,
      cursor.createdAt,
      cursor.id
    );
    const start = params.length - 4;
    whereParts.push(
      `(
        CASE
          WHEN estado = 'Publicada' AND (fecha_cierre IS NULL OR fecha_cierre >= NOW()) THEN 1
          ELSE 0
        END,
        COALESCE(monto_estimado, 0),
        COALESCE(fecha_publicacion, created_at),
        created_at,
        id
      ) < ($${start}, $${start + 1}, $${start + 2}::timestamptz, $${start + 3}::timestamptz, $${start + 4})`
    );
  }

  return {
    whereClause: `WHERE ${whereParts.join(" AND ")}`,
    params,
    paramIndex: params.length + 1,
  };
}

function buildClosingSoonWhere(
  filters: LicitacionesFilters,
  windowStart: Date,
  cursor: FeedCursor | null
): BuildWhereResult {
  const params: unknown[] = [windowStart.toISOString()];
  const whereParts = ["COALESCE(fecha_publicacion, created_at) >= $1"];

  appendBaseFilters(filters, params, whereParts);

  if (cursor) {
    if (cursor.mode !== "closing_soon") {
      throw new Error("Cursor no coincide con closing_soon");
    }

    params.push(
      cursor.activeBucket,
      cursor.closingRank,
      cursor.primaryDate,
      cursor.createdAt,
      cursor.id
    );
    const start = params.length - 4;
    whereParts.push(
      `(
        CASE
          WHEN estado = 'Publicada' AND (fecha_cierre IS NULL OR fecha_cierre >= NOW()) THEN 1
          ELSE 0
        END,
        CASE
          WHEN estado = 'Publicada' AND fecha_cierre IS NOT NULL AND fecha_cierre >= NOW()
            THEN -EXTRACT(EPOCH FROM fecha_cierre) * 1000
          ELSE ${FAR_PAST_RANK}
        END,
        COALESCE(fecha_publicacion, created_at),
        created_at,
        id
      ) < ($${start}, $${start + 1}, $${start + 2}::timestamptz, $${start + 3}::timestamptz, $${start + 4})`
    );
  }

  return {
    whereClause: `WHERE ${whereParts.join(" AND ")}`,
    params,
    paramIndex: params.length + 1,
  };
}

function buildQueryParts(
  sortMode: FeedSortMode,
  filters: LicitacionesFilters,
  windowStart: Date,
  cursor: FeedCursor | null
) {
  if (sortMode === "closing_soon") {
    return {
      ...buildClosingSoonWhere(filters, windowStart, cursor),
      orderBy: `ORDER BY
        CASE
          WHEN estado = 'Publicada' AND (fecha_cierre IS NULL OR fecha_cierre >= NOW()) THEN 1
          ELSE 0
        END DESC,
        CASE
          WHEN estado = 'Publicada' AND fecha_cierre IS NOT NULL AND fecha_cierre >= NOW()
            THEN -EXTRACT(EPOCH FROM fecha_cierre) * 1000
          ELSE ${FAR_PAST_RANK}
        END DESC,
        COALESCE(fecha_publicacion, created_at) DESC,
        created_at DESC,
        id DESC`,
    };
  }

  if (sortMode === "most_relevant") {
    return {
      ...buildMostRelevantWhere(filters, windowStart, cursor),
      orderBy: `ORDER BY
        CASE
          WHEN estado = 'Publicada' AND (fecha_cierre IS NULL OR fecha_cierre >= NOW()) THEN 1
          ELSE 0
        END DESC,
        COALESCE(monto_estimado, 0) DESC,
        COALESCE(fecha_publicacion, created_at) DESC,
        created_at DESC,
        id DESC`,
    };
  }

  return {
      ...buildLatestPublishedWhere(filters, windowStart, cursor),
    orderBy:
      "ORDER BY COALESCE(fecha_publicacion, created_at) DESC, COALESCE(-source_rank, -2147483647) DESC, created_at DESC, id DESC",
  };
}

/**
 * GET /api/licitaciones
 * Lista las licitaciones recientes usando cursor pagination.
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const limit = readLimit(req);
    const windowDays = readWindowDays(req);
    const sortMode = readSortMode(req);
    const cursor = decodeCursor(req.query.cursor);

    if (req.query.cursor && !cursor) {
      res.status(400).json({ error: "Cursor inválido" });
      return;
    }

    if (cursor && cursor.mode !== sortMode) {
      res.status(400).json({ error: "Cursor no coincide con el orden solicitado" });
      return;
    }

    const filters = readFilters(req);
    const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const startedAt = Date.now();

    const { whereClause, params, paramIndex, orderBy } = buildQueryParts(
      sortMode,
      filters,
      windowStart,
      cursor
    );

    params.push(limit + 1);

    const rows = await query<LicitacionRow>(
      `SELECT id, codigo_externo, nombre, organismo_nombre, tipo,
              monto_estimado, monto_label, moneda, fecha_publicacion, fecha_cierre,
              estado, url, region, categoria, source_rank, created_at
       FROM licitaciones
       ${whereClause}
       ${orderBy}
       LIMIT $${paramIndex}`,
      params
    );

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && pageRows.length > 0
        ? encodeCursor(pageRows[pageRows.length - 1]!, sortMode)
        : null;

    apiLogger.info("licitaciones_feed_request", {
      limit,
      hasMore,
      returnedRows: pageRows.length,
      windowDays,
      sortMode,
      durationMs: Date.now() - startedAt,
    });

    res.json({
      data: pageRows.map(formatLicitacion),
      pageInfo: {
        limit,
        hasMore,
        nextCursor,
        sortMode,
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
       WHERE COALESCE(fecha_publicacion, created_at) >= $1
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
              estado, url, region, categoria, source_rank, created_at
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
