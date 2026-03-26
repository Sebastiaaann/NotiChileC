import { Router, type Request, type Response } from "express";
import { query, queryOne } from "../db";

const router = Router();

interface LicitacionRow {
  id: string;
  codigo_externo: string;
  nombre: string;
  organismo_nombre: string | null;
  tipo: string | null;
  monto_estimado: string | null;
  moneda: string;
  fecha_publicacion: string | null;
  fecha_cierre: string | null;
  estado: string;
  url: string | null;
  region: string | null;
  categoria: string;
  created_at: string;
}

/**
 * GET /api/licitaciones
 * Lista las licitaciones más recientes con paginación.
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const rows = await query<LicitacionRow>(
      `SELECT id, codigo_externo, nombre, organismo_nombre, tipo,
              monto_estimado, moneda, fecha_publicacion, fecha_cierre,
              estado, url, region, categoria, created_at
       FROM licitaciones
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );

    const countResult = await queryOne<{ total: string }>(
      `SELECT COUNT(*) as total FROM licitaciones`
    );
    const total = Number(countResult?.total ?? 0);

    res.json({
      data: rows.map(formatLicitacion),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error("[licitaciones] Error listando:", error);
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
              monto_estimado, moneda, fecha_publicacion, fecha_cierre,
              estado, url, region, categoria, created_at
       FROM licitaciones
       WHERE id = $1 OR codigo_externo = $1`,
      [req.params.id]
    );

    if (!row) {
      res.status(404).json({ error: "Licitación no encontrada" });
      return;
    }

    res.json({ data: formatLicitacion(row) });
  } catch (error) {
    console.error("[licitaciones] Error obteniendo detalle:", error);
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
      : null,
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
