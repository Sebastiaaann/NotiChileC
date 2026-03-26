import {
  fetchLicitacionesSummary,
  fetchLicitacionDetail,
  mapDetailToRecord,
  type LicitacionRecord,
  type ChileCompraSummaryItem,
} from "./chilecompra";
import { scrapeLicitaciones, scrapedToRecord, type ScrapedLicitacion } from "./scraper";
import { query } from "./db";
import { sendPushToAll } from "./push";

const DETAIL_DELAY_MS = 300;
let consecutiveFailures = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface WorkerResult {
  found: number;
  inserted: number;
  notificationsSent: number;
  errors: string[];
}

/**
 * Ejecuta un ciclo completo del worker:
 * 1. Consulta licitaciones publicadas hoy en ChileCompra
 * 2. Compara con lo que hay en DB
 * 3. Inserta las nuevas
 * 4. Envía push notifications para cada nueva
 */
export async function runSyncCycle(): Promise<WorkerResult> {
  const startedAt = new Date();
  const result: WorkerResult = {
    found: 0,
    inserted: 0,
    notificationsSent: 0,
    errors: [],
  };

  let runId: number | undefined;

  try {
    console.log(`[worker] Iniciando ciclo de sync — ${startedAt.toISOString()}`);

    // Registrar inicio en worker_runs
    const runRows = await query<{ id: number }>(
      `INSERT INTO worker_runs (started_at) VALUES ($1) RETURNING id`,
      [startedAt]
    );
    runId = runRows[0]?.id;

    // 1. Obtener licitaciones — SIEMPRE scraper + API como enriquecimiento
    let newRecords: LicitacionRecord[] = [];
    const recordsToInsert: LicitacionRecord[] = [];

    // --- SIEMPRE ejecutar scraper (fuente principal) ---
    try {
      const scrapeResult = await scrapeLicitaciones(20); // 200 licitaciones
      result.found = scrapeResult.items.length;
      console.log(
        `[worker] Scraper obtuvo ${scrapeResult.items.length} licitaciones`
      );

      if (scrapeResult.items.length > 0) {
        // Verificar existentes
        const codigos = scrapeResult.items.map((s) => s.codigoExterno);
        const existingRows = await query<{ codigo_externo: string }>(
          `SELECT codigo_externo FROM licitaciones WHERE codigo_externo = ANY($1::text[])`,
          [codigos]
        );
        const existingSet = new Set(existingRows.map((r) => r.codigo_externo));
        const newItems = scrapeResult.items.filter(
          (s) => !existingSet.has(s.codigoExterno)
        );

        console.log(
          `[worker] ${newItems.length} licitaciones nuevas (de ${scrapeResult.items.length} scrapeadas)`
        );

        for (const item of newItems) {
          recordsToInsert.push(scrapedToRecord(item));
        }
      }
    } catch (scraperError) {
      console.error(
        `[worker] Scraper falló:`,
        scraperError instanceof Error ? scraperError.message : scraperError
      );
    }

    // --- API como enriquecimiento (si funciona) ---
    try {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const [todaySummaries, yesterdaySummaries] = await Promise.all([
        fetchLicitacionesSummary(today),
        fetchLicitacionesSummary(yesterday),
      ]);

      // Deduplicar
      const seen = new Set<string>();
      const apiSummaries = [...todaySummaries, ...yesterdaySummaries].filter(
        (s) => {
          if (seen.has(s.CodigoExterno)) return false;
          seen.add(s.CodigoExterno);
          return true;
        }
      );

      consecutiveFailures = 0;
      console.log(`[worker] API devolvió ${apiSummaries.length} licitaciones`);

      // Verificar existentes e incompletas
      const apiCodigos = apiSummaries.map((s) => s.CodigoExterno);
      const apiExistingRows = await query<{
        codigo_externo: string;
        incompleta: boolean;
      }>(
        `SELECT codigo_externo,
                (organismo_nombre IS NULL OR tipo IS NULL OR monto_estimado IS NULL) as incompleta
         FROM licitaciones WHERE codigo_externo = ANY($1::text[])`,
        [apiCodigos]
      );
      const apiExistingSet = new Set(
        apiExistingRows.map((r) => r.codigo_externo)
      );
      const incompleteSet = new Set(
        apiExistingRows.filter((r) => r.incompleta).map((r) => r.codigo_externo)
      );

      // Nuevas desde API (que el scraper no capturó)
      const newFromApi = apiSummaries.filter(
        (s) => !apiExistingSet.has(s.CodigoExterno)
      );
      // Incompletas para enriquecer
      const toEnrich = apiSummaries.filter(
        (s) => apiExistingSet.has(s.CodigoExterno) && incompleteSet.has(s.CodigoExterno)
      );

      console.log(
        `[worker] API: ${newFromApi.length} nuevas adicionales, ${toEnrich.length} a enriquecer`
      );

      // Insertar nuevas desde API (con detalle completo)
      for (const summary of newFromApi) {
        try {
          const detail = await fetchLicitacionDetail(summary.CodigoExterno);
          recordsToInsert.push(mapDetailToRecord(summary, detail));
          await sleep(DETAIL_DELAY_MS);
        } catch (error) {
          console.error(
            `[worker] Error detalle ${summary.CodigoExterno}:`,
            error instanceof Error ? error.message : error
          );
          // Si falla el detalle, agregar registro mínimo desde summary
          recordsToInsert.push({
            id: summary.CodigoExterno,
            codigo_externo: summary.CodigoExterno,
            nombre: summary.Nombre ?? "Sin nombre",
            organismo_nombre: null,
            tipo: null,
            monto_estimado: null,
            monto_label: null,
            moneda: "CLP",
            fecha_publicacion: new Date().toISOString(),
            fecha_cierre: summary.FechaCierre ?? null,
            estado: "Publicada",
            url: `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(summary.CodigoExterno)}`,
            region: null,
            categoria: "General",
          });
        }
      }

      // Enriquecer incompletas
      for (const summary of toEnrich) {
        try {
          const detail = await fetchLicitacionDetail(summary.CodigoExterno);
          const record = mapDetailToRecord(summary, detail);
          await query(
            `UPDATE licitaciones SET
              nombre = $2, organismo_nombre = $3, tipo = $4,
              monto_estimado = $5, moneda = $6, fecha_publicacion = $7::timestamptz,
              fecha_cierre = $8::timestamptz, estado = $9, url = $10,
              region = $11, categoria = $12
            WHERE codigo_externo = $1
              AND (organismo_nombre IS NULL OR tipo IS NULL OR monto_estimado IS NULL)`,
            [
              record.codigo_externo,
              record.nombre,
              record.organismo_nombre,
              record.tipo,
              record.monto_estimado,
              record.moneda,
              record.fecha_publicacion,
              record.fecha_cierre,
              record.estado,
              record.url,
              record.region,
              record.categoria,
            ]
          );
          console.log(`[worker] Enriquecida: ${summary.CodigoExterno}`);
          await sleep(DETAIL_DELAY_MS);
        } catch (error) {
          console.error(
            `[worker] Error enriqueciendo ${summary.CodigoExterno}:`,
            error instanceof Error ? error.message : error
          );
        }
      }
    } catch (apiError) {
      const apiMsg =
        apiError instanceof Error ? apiError.message : "Error desconocido";
      console.warn(`[worker] API no disponible: ${apiMsg}`);
      consecutiveFailures++;
      if (consecutiveFailures >= 3) {
        console.error(
          `[worker] ALERTA: ${consecutiveFailures} fallos consecutivos de ChileCompra API`
        );
      }
    }

    // Insertar registros nuevos en DB
    for (const record of recordsToInsert) {
      try {
        await query(
          `INSERT INTO licitaciones (
            id, codigo_externo, nombre, organismo_nombre, tipo,
            monto_estimado, monto_label, moneda, fecha_publicacion, fecha_cierre,
            estado, url, region, categoria, notificada
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9::timestamptz, $10::timestamptz,
            $11, $12, $13, $14, FALSE
          )
          ON CONFLICT (codigo_externo) DO NOTHING`,
          [
            record.id,
            record.codigo_externo,
            record.nombre,
            record.organismo_nombre,
            record.tipo,
            record.monto_estimado,
            record.monto_label,
            record.moneda,
            record.fecha_publicacion,
            record.fecha_cierre,
            record.estado,
            record.url,
            record.region,
            record.categoria,
          ]
        );
        result.inserted++;
        newRecords.push(record);
      } catch (error) {
        console.error(
          `[worker] Error insertando ${record.codigo_externo}:`,
          error instanceof Error ? error.message : error
        );
      }
    }

    // 4. Enviar push notifications para las nuevas licitaciones
    if (newRecords.length > 0) {
      console.log(`[worker] Enviando notificaciones para ${newRecords.length} licitaciones nuevas`);

      for (const record of newRecords) {
        try {
          const montoStr = record.monto_estimado
            ? new Intl.NumberFormat("es-CL", {
                style: "currency",
                currency: record.moneda,
                maximumFractionDigits: 0,
              }).format(record.monto_estimado)
            : "";

          const pushResult = await sendPushToAll(
            "📋 Nueva Licitación",
            `${record.nombre}${montoStr ? ` — ${montoStr}` : ""}`,
            {
              licitacionId: record.id,
              codigo: record.codigo_externo,
              type: "new_licitacion",
            }
          );

          result.notificationsSent += pushResult.sent;

          if (pushResult.sent > 0) {
            await query(
              `UPDATE licitaciones SET notificada = TRUE WHERE id = $1`,
              [record.id]
            );
          } else {
            console.warn(
              `[worker] Sin tokens activos, licitación ${record.codigo_externo} no notificada. Se reintentará.`
            );
          }
        } catch (error) {
          console.error(
            `[worker] Error enviando push para ${record.codigo_externo}:`,
            error
          );
        }
      }
    }

    console.log(
      `[worker] Ciclo completado — Nuevas: ${result.inserted}, Notificaciones: ${result.notificationsSent}`
    );

    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error(`[worker] ChileCompra API caída: ${msg}`);
    result.errors.push(msg);
    consecutiveFailures++;
    if (consecutiveFailures >= 3) {
      console.error(
        `[worker] ALERTA: ${consecutiveFailures} fallos consecutivos de ChileCompra API`
      );
    }
  } finally {
    await finishRun(runId, startedAt, result);
  }

  return result;
}

async function finishRun(
  runId: number | undefined,
  startedAt: Date,
  result: WorkerResult
): Promise<void> {
  if (!runId) return;

  try {
    await query(
      `UPDATE worker_runs SET
        finished_at = NOW(),
        licitaciones_found = $1,
        licitaciones_new = $2,
        notifications_sent = $3,
        error_message = $4
      WHERE id = $5`,
      [
        result.found,
        result.inserted,
        result.notificationsSent,
        result.errors.length > 0 ? result.errors.join("; ") : null,
        runId,
      ]
    );
  } catch (error) {
    console.error("[worker] Error registrando resultado:", error);
  }
}
