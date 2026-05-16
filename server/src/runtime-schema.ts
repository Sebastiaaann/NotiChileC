import { db } from "./db";
import { sql } from "drizzle-orm";

let ensureRuntimeSchemaPromise: Promise<void> | null = null;

async function runRuntimeSchemaSync(): Promise<void> {
  await db.execute(sql`
    DO $$
    BEGIN
      IF to_regclass('public.licitaciones') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.licitaciones ADD COLUMN IF NOT EXISTS source_rank INTEGER';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_licitaciones_fecha_publicacion_source_rank ON licitaciones (fecha_publicacion DESC, source_rank ASC, created_at DESC, id DESC)';
      END IF;

      IF to_regclass('archive.licitaciones') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE archive.licitaciones ADD COLUMN IF NOT EXISTS source_rank INTEGER';
      END IF;
    END $$;
  `);
}

export async function ensureRuntimeSchema(): Promise<void> {
  if (!ensureRuntimeSchemaPromise) {
    ensureRuntimeSchemaPromise = runRuntimeSchemaSync().catch((error) => {
      ensureRuntimeSchemaPromise = null;
      throw error;
    });
  }

  await ensureRuntimeSchemaPromise;
}
