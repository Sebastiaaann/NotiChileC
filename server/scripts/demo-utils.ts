import { createDirectPool } from "../src/db";
import { DEMO_FIXTURE_LICITACIONES } from "../src/demo/fixtures";
import type { PoolClient } from "pg";

export function assertDemoMode() {
  if (process.env.DEMO_MODE !== "true") {
    throw new Error(
      "DEMO_MODE debe estar en true para correr scripts demo contra una base separada"
    );
  }
}

export async function withDirectClient<T>(
  applicationName: string,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = createDirectPool(applicationName);
  const client = await pool.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
    await pool.end();
  }
}

export async function deleteDemoFixtures(client: { query: (text: string, params?: unknown[]) => Promise<unknown> }) {
  await client.query(
    `DELETE FROM notification_deliveries
     WHERE notification_event_id IN (
       SELECT id FROM notification_events WHERE licitacion_id LIKE 'demo-licitacion-%'
     )`
  );
  await client.query(
    `DELETE FROM notification_events WHERE licitacion_id LIKE 'demo-licitacion-%'`
  );
  await client.query(
    `DELETE FROM licitacion_registry WHERE codigo_externo LIKE 'DEMO-%'`
  );
  await client.query(
    `DELETE FROM licitaciones WHERE codigo_externo LIKE 'DEMO-%'`
  );
}

export async function insertDemoFixtures(client: { query: (text: string, params?: unknown[]) => Promise<{ rowCount?: number }> }) {
  let inserted = 0;
  for (const fixture of DEMO_FIXTURE_LICITACIONES) {
    await client.query(
      `INSERT INTO licitacion_registry (codigo_externo, licitacion_id, created_at, updated_at)
       VALUES ($1, $2, $3::timestamptz, NOW())
       ON CONFLICT (codigo_externo) DO UPDATE
       SET licitacion_id = EXCLUDED.licitacion_id,
           updated_at = NOW()`,
      [fixture.codigo_externo, fixture.id, fixture.created_at]
    );

    const result = await client.query(
      `INSERT INTO licitaciones (
          id,
          codigo_externo,
          nombre,
          organismo_nombre,
          tipo,
          monto_estimado,
          monto_label,
          moneda,
          fecha_publicacion,
          fecha_cierre,
          estado,
          url,
          region,
          categoria,
          rubro_code,
          notificada,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9::timestamptz, $10::timestamptz, $11, $12, $13, $14, $15,
          FALSE, $16::timestamptz, NOW()
        )`,
      [
        fixture.id,
        fixture.codigo_externo,
        fixture.nombre,
        fixture.organismo_nombre,
        fixture.tipo,
        fixture.monto_estimado,
        fixture.monto_label,
        fixture.moneda,
        fixture.fecha_publicacion,
        fixture.fecha_cierre,
        fixture.estado,
        fixture.url,
        fixture.region,
        fixture.categoria,
        fixture.rubro_code,
        fixture.created_at,
      ]
    );

    if ((result.rowCount ?? 0) > 0) {
      inserted += 1;
    }
  }

  return inserted;
}
