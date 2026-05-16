import { Router } from "express";
import { asc } from "drizzle-orm";
import { db } from "../db";
import { rubrosChilecompra } from "../db/schema/rubros-chilecompra";
import { apiLogger } from "../observability/logger";
import { captureException } from "../observability/sentry";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(rubrosChilecompra)
      .orderBy(asc(rubrosChilecompra.code));

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
