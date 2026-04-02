import { Router } from "express";
import { query } from "../db";
import { apiLogger } from "../observability/logger";
import { captureException } from "../observability/sentry";

const router = Router();

export interface Rubro extends Record<string, unknown> {
  code: string;
  name: string;
  parent_code: string | null;
}

router.get("/", async (req, res) => {
  try {
    const rows = await query<Rubro>(
      `SELECT code, name, parent_code FROM rubros_chilecompra ORDER BY code ASC`
    );
    res.json({
      data: rows.map(r => ({
        code: r.code,
        name: r.name,
        parentCode: r.parent_code
      }))
    });
  } catch (error) {
    captureException(error, { route: "/api/rubros", method: "GET" });
    apiLogger.error("rubros_fetch_failed", {
      route: "/api/rubros",
      error_code: "rubros_fetch_failed",
      error: error instanceof Error ? error : new Error(String(error)),
    });
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
