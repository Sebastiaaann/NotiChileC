import {
  fetchLicitacionesSummary,
  fetchLicitacionDetail,
  mapDetailToRecord,
  type LicitacionRecord,
} from "./chilecompra";
import { scrapeLicitaciones, scrapedToRecord } from "./scraper";
import { query, queryResult } from "./db";
import { createExpoPushProvider } from "./push";
import type {
  PushNotificationInput,
  PushProvider,
  PushReceiptOutcome,
} from "./push-provider";
import {
  buildNewLicitacionNotificationPayload,
  matchesNotificationPreferences,
  type NewLicitacionNotificationContext,
  type NotificationPreferenceSnapshot,
} from "./notification-targeting";
import { runArchiveExportCycle as runArchiveExportJob } from "./archive-jobs";
import {
  observeArchiveExport,
  observeWorkerRun,
} from "./observability/metrics";
import { workerLogger } from "./observability/logger";
import { captureException } from "./observability/sentry";

const DETAIL_DELAY_MS = 300;
const EVENT_TYPE_NEW_LICITACION = "new_licitacion";
const HOT_RETENTION_MONTHS = 12;
const DELIVERY_RETENTION_DAYS = 90;
const DEFAULT_PUSH_PROVIDER = createExpoPushProvider();

let consecutiveFailures = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildExponentialBackoff(attemptCount: number): string {
  const cappedAttempt = Math.min(Math.max(attemptCount, 1), 6);
  const delayMinutes = Math.min(60, Math.pow(2, cappedAttempt - 1));
  return new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
}

function logObject(prefix: string, payload: Record<string, unknown>): void {
  workerLogger.info(prefix, payload);
}

export interface WorkerResult {
  found: number;
  inserted: number;
  notificationsSent: number;
  notificationsRetryable: number;
  notificationsFailed: number;
  notificationsInvalidated: number;
  targetsSelected: number;
  deliveriesCreated: number;
  receiptsProcessed: number;
  archivedLicitaciones: number;
  archivedDeliveries: number;
  archiveExports: number;
  archiveVerified: number;
  archiveDropped: number;
  errors: string[];
}

interface WorkerDependencies {
  query: typeof query;
  queryResult: typeof queryResult;
  pushProvider: PushProvider;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
}

interface DeviceInstallationRow extends Record<string, unknown> {
  installation_id: string;
  push_token: string | null;
  platform: string;
  environment: string;
  app_version: string;
  push_capable: boolean;
  permission_status: string;
  active: boolean;
  invalidated_at: string | Date | null;
  invalid_reason: string | null;
  last_seen_at: string | Date | null;
  enabled: boolean | null;
  rubro: string | null;
  tipo: string | null;
  region: string | null;
  monto_min: number | string | null;
  monto_max: number | string | null;
}

interface NotificationEventRow extends Record<string, unknown> {
  id: number;
}

interface DispatchDeliveryRow extends DeviceInstallationRow {
  delivery_id: number;
  notification_event_id: number;
  provider: string;
  status: string;
  provider_ticket_id: string | null;
  provider_receipt_id: string | null;
  attempt_count: number;
  licitacion_id: string;
  licitacion_nombre: string;
  licitacion_codigo_externo: string;
  licitacion_tipo: string | null;
  licitacion_region: string | null;
  licitacion_rubro_code: string | null;
  licitacion_monto_estimado: number | string | null;
  licitacion_monto_label: string | null;
  licitacion_moneda: string;
}

interface ReceiptDeliveryRow extends Record<string, unknown> {
  delivery_id: number;
  installation_id: string;
  provider_ticket_id: string;
  attempt_count: number;
}

function emptyWorkerResult(): WorkerResult {
  return {
    found: 0,
    inserted: 0,
    notificationsSent: 0,
    notificationsRetryable: 0,
    notificationsFailed: 0,
    notificationsInvalidated: 0,
    targetsSelected: 0,
    deliveriesCreated: 0,
    receiptsProcessed: 0,
    archivedLicitaciones: 0,
    archivedDeliveries: 0,
    archiveExports: 0,
    archiveVerified: 0,
    archiveDropped: 0,
    errors: [],
  };
}

function mergeResults(...results: WorkerResult[]): WorkerResult {
  return results.reduce<WorkerResult>((acc, current) => ({
    found: acc.found + current.found,
    inserted: acc.inserted + current.inserted,
    notificationsSent: acc.notificationsSent + current.notificationsSent,
    notificationsRetryable:
      acc.notificationsRetryable + current.notificationsRetryable,
    notificationsFailed: acc.notificationsFailed + current.notificationsFailed,
    notificationsInvalidated:
      acc.notificationsInvalidated + current.notificationsInvalidated,
    targetsSelected: acc.targetsSelected + current.targetsSelected,
    deliveriesCreated: acc.deliveriesCreated + current.deliveriesCreated,
    receiptsProcessed: acc.receiptsProcessed + current.receiptsProcessed,
    archivedLicitaciones:
      acc.archivedLicitaciones + current.archivedLicitaciones,
    archivedDeliveries: acc.archivedDeliveries + current.archivedDeliveries,
    archiveExports: acc.archiveExports + current.archiveExports,
    archiveVerified: acc.archiveVerified + current.archiveVerified,
    archiveDropped: acc.archiveDropped + current.archiveDropped,
    errors: [...acc.errors, ...current.errors],
  }), emptyWorkerResult());
}

function mergePreferDetailedRecord(
  current: LicitacionRecord,
  incoming: LicitacionRecord
): LicitacionRecord {
  const currentScore = [
    current.organismo_nombre,
    current.tipo,
    current.monto_estimado,
    current.rubro_code,
  ].filter(Boolean).length;
  const incomingScore = [
    incoming.organismo_nombre,
    incoming.tipo,
    incoming.monto_estimado,
    incoming.rubro_code,
  ].filter(Boolean).length;

  return incomingScore >= currentScore ? incoming : current;
}

function upsertPendingRecord(
  pendingRecords: Map<string, LicitacionRecord>,
  record: LicitacionRecord
): void {
  const existing = pendingRecords.get(record.codigo_externo);
  if (!existing) {
    pendingRecords.set(record.codigo_externo, record);
    return;
  }

  pendingRecords.set(
    record.codigo_externo,
    mergePreferDetailedRecord(existing, record)
  );
}

function asNotificationContext(
  record: LicitacionRecord
): NewLicitacionNotificationContext {
  return {
    id: record.id,
    codigo_externo: record.codigo_externo,
    nombre: record.nombre,
    monto_estimado: record.monto_estimado,
    monto_label: record.monto_label,
    moneda: record.moneda,
    tipo: record.tipo,
    region: record.region,
    rubro_code: record.rubro_code,
  };
}

function asDeliveryNotificationContext(
  row: DispatchDeliveryRow
): NewLicitacionNotificationContext {
  return {
    id: row.licitacion_id,
    codigo_externo: row.licitacion_codigo_externo,
    nombre: row.licitacion_nombre,
    monto_estimado: toNullableNumber(row.licitacion_monto_estimado),
    monto_label: row.licitacion_monto_label,
    moneda: row.licitacion_moneda,
    tipo: row.licitacion_tipo,
    region: row.licitacion_region,
    rubro_code: row.licitacion_rubro_code,
  };
}

function buildPreferenceSnapshot(
  row: DeviceInstallationRow
): NotificationPreferenceSnapshot {
  return {
    enabled: row.enabled ?? true,
    rubro: row.rubro,
    tipo: row.tipo,
    region: row.region,
    montoMin: toNullableNumber(row.monto_min),
    montoMax: toNullableNumber(row.monto_max),
  };
}

function isInstallationAllowed(row: DeviceInstallationRow): boolean {
  return (
    row.active &&
    row.push_capable &&
    row.permission_status === "granted" &&
    row.invalidated_at === null &&
    typeof row.push_token === "string" &&
    row.push_token.length > 0
  );
}

function createDefaultDependencies(): WorkerDependencies {
  return {
    query,
    queryResult,
    pushProvider: DEFAULT_PUSH_PROVIDER,
    now: () => new Date(),
    sleep,
  };
}

async function ensureLicitacionPartitions(
  deps: WorkerDependencies
): Promise<void> {
  await deps.query(`SELECT ensure_licitaciones_monthly_partitions($1, $2)`, [
    HOT_RETENTION_MONTHS,
    2,
  ]);
}

async function archiveOldLicitaciones(
  deps: WorkerDependencies
): Promise<number> {
  const rows = await deps.query<{ archived_count: string | number }>(
    `SELECT archive_old_licitaciones($1) AS archived_count`,
    [HOT_RETENTION_MONTHS]
  );

  return Number(rows[0]?.archived_count ?? 0);
}

async function archiveOldDeliveries(
  deps: WorkerDependencies
): Promise<number> {
  const rows = await deps.query<{ archived_count: string | number }>(
    `SELECT archive_old_notification_deliveries($1) AS archived_count`,
    [DELIVERY_RETENTION_DAYS]
  );

  return Number(rows[0]?.archived_count ?? 0);
}
async function createNotificationEvent(
  deps: WorkerDependencies,
  record: LicitacionRecord
): Promise<number> {
  const rows = await deps.query<NotificationEventRow>(
    `
      INSERT INTO notification_events (type, licitacion_id, created_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (type, licitacion_id) DO UPDATE SET type = EXCLUDED.type
      RETURNING id
    `,
    [EVENT_TYPE_NEW_LICITACION, record.id]
  );

  const eventId = rows[0]?.id;
  if (!eventId) {
    throw new Error(
      `No se pudo crear o recuperar notification_event para ${record.codigo_externo}`
    );
  }

  return eventId;
}

async function loadExistingCodigos(
  deps: WorkerDependencies,
  codigos: string[]
): Promise<Set<string>> {
  if (codigos.length === 0) return new Set();

  const rows = await deps.query<{ codigo_externo: string }>(
    `SELECT codigo_externo FROM licitacion_registry WHERE codigo_externo = ANY($1::text[])`,
    [codigos]
  );

  return new Set(rows.map((row) => row.codigo_externo));
}

async function loadCandidateInstallations(
  deps: WorkerDependencies,
  context: NewLicitacionNotificationContext
): Promise<DeviceInstallationRow[]> {
  const conditions: string[] = [
    "di.active = TRUE",
    "COALESCE(np.enabled, TRUE) = TRUE",
  ];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (context.rubro_code) {
    conditions.push(`(np.rubro IS NULL OR $${paramIndex} LIKE np.rubro || '%')`);
    params.push(context.rubro_code);
    paramIndex++;
  }

  if (context.tipo) {
    conditions.push(`(np.tipo IS NULL OR np.tipo = $${paramIndex})`);
    params.push(context.tipo);
    paramIndex++;
  }

  if (context.region) {
    conditions.push(`(np.region IS NULL OR np.region = $${paramIndex})`);
    params.push(context.region);
    paramIndex++;
  }

  if (context.monto_estimado !== null && context.monto_estimado !== undefined) {
    conditions.push(`(np.monto_min IS NULL OR np.monto_min <= $${paramIndex})`);
    params.push(context.monto_estimado);
    paramIndex++;
    conditions.push(`(np.monto_max IS NULL OR np.monto_max >= $${paramIndex})`);
    params.push(context.monto_estimado);
  }

  return deps.query<DeviceInstallationRow>(
    `
      SELECT
        di.installation_id,
        di.push_token,
        di.platform,
        di.environment,
        di.app_version,
        di.push_capable,
        di.permission_status,
        di.active,
        di.invalidated_at,
        di.invalid_reason,
        di.last_seen_at,
        COALESCE(np.enabled, TRUE) AS enabled,
        np.rubro,
        np.tipo,
        np.region,
        np.monto_min,
        np.monto_max
      FROM device_installations di
      LEFT JOIN notification_preferences np
        ON np.installation_id = di.installation_id
      WHERE ${conditions.join(" AND ")}
    `,
    params
  );
}

function buildDeliveryInsertValues(
  eventId: number,
  installationIds: string[]
): { sql: string; params: unknown[] } {
  if (installationIds.length === 0) {
    return {
      sql: "",
      params: [],
    };
  }

  const params: unknown[] = [];
  const rows: string[] = [];
  let index = 1;

  for (const installationId of installationIds) {
    rows.push(
      `($${index++}, $${index++}, 'pending', 'expo', NOW(), NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL)`
    );
    params.push(eventId, installationId);
  }

  return {
    sql: `
      INSERT INTO notification_deliveries (
        notification_event_id,
        installation_id,
        status,
        provider,
        next_attempt_at,
        locked_at,
        locked_by,
        completed_at,
        provider_ticket_id,
        attempt_count,
        last_error_code,
        last_error_message,
        last_attempt_at
      ) VALUES ${rows.join(", ")}
      ON CONFLICT (notification_event_id, installation_id) DO NOTHING
    `,
    params,
  };
}

async function createNotificationDeliveries(
  deps: WorkerDependencies,
  eventId: number,
  installationIds: string[]
): Promise<number> {
  if (installationIds.length === 0) return 0;

  const built = buildDeliveryInsertValues(eventId, installationIds);
  const result = await deps.queryResult<Record<string, never>>(
    built.sql,
    built.params
  );

  return result.rowCount ?? 0;
}

async function invalidateInstallation(
  deps: WorkerDependencies,
  installationId: string,
  reason: string
): Promise<void> {
  await deps.query(
    `
      UPDATE device_installations SET
        active = FALSE,
        invalidated_at = NOW(),
        invalid_reason = $2,
        updated_at = NOW()
      WHERE installation_id = $1
    `,
    [installationId, reason]
  );
}

async function markDeliverySkipped(
  deps: WorkerDependencies,
  deliveryId: number,
  status: "failed" | "invalid",
  errorCode: string,
  errorMessage: string
): Promise<void> {
  await deps.query(
    `
      UPDATE notification_deliveries SET
        status = $2,
        last_error_code = $3,
        last_error_message = $4,
        locked_at = NULL,
        locked_by = NULL,
        completed_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
    `,
    [deliveryId, status, errorCode, errorMessage]
  );
}

async function updateDispatchOutcome(
  deps: WorkerDependencies,
  delivery: DispatchDeliveryRow,
  outcome: Awaited<ReturnType<PushProvider["send"]>>[number]
): Promise<void> {
  await deps.query(
    `
      UPDATE notification_deliveries SET
        status = $2,
        provider_ticket_id = $3,
        provider_receipt_id = $4,
        attempt_count = attempt_count + 1,
        last_error_code = $5,
        last_error_message = $6,
        last_attempt_at = NOW(),
        next_attempt_at = $7::timestamptz,
        locked_at = NULL,
        locked_by = NULL,
        completed_at = CASE WHEN $2 IN ('failed', 'invalid') THEN NOW() ELSE completed_at END,
        updated_at = NOW()
      WHERE id = $1
    `,
    [
      delivery.delivery_id,
      outcome.status,
      outcome.providerTicketId,
      outcome.providerReceiptId,
      outcome.errorCode,
      outcome.errorMessage,
      outcome.status === "retryable"
        ? buildExponentialBackoff(delivery.attempt_count + 1)
        : null,
    ]
  );
}
async function lockDispatchDeliveries(
  deps: WorkerDependencies,
  workerId: string,
  limit: number
): Promise<DispatchDeliveryRow[]> {
  return deps.query<DispatchDeliveryRow>(
    `
      WITH due AS (
        SELECT nd.id
        FROM notification_deliveries nd
        WHERE nd.status IN ('pending', 'retryable')
          AND nd.completed_at IS NULL
          AND COALESCE(nd.next_attempt_at, nd.created_at) <= NOW()
          AND nd.locked_at IS NULL
        ORDER BY nd.created_at ASC, nd.id ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      ),
      locked AS (
        UPDATE notification_deliveries nd
        SET locked_at = NOW(),
            locked_by = $2,
            updated_at = NOW()
        FROM due
        WHERE nd.id = due.id
        RETURNING nd.*
      )
      SELECT
        locked.id AS delivery_id,
        locked.notification_event_id,
        locked.installation_id,
        locked.provider,
        locked.status,
        locked.provider_ticket_id,
        locked.provider_receipt_id,
        locked.attempt_count,
        di.push_token,
        di.platform,
        di.environment,
        di.app_version,
        di.push_capable,
        di.permission_status,
        di.active,
        di.invalidated_at,
        di.invalid_reason,
        di.last_seen_at,
        COALESCE(np.enabled, TRUE) AS enabled,
        np.rubro,
        np.tipo,
        np.region,
        np.monto_min,
        np.monto_max,
        ne.licitacion_id,
        l.nombre AS licitacion_nombre,
        l.codigo_externo AS licitacion_codigo_externo,
        l.tipo AS licitacion_tipo,
        l.region AS licitacion_region,
        l.rubro_code AS licitacion_rubro_code,
        l.monto_estimado AS licitacion_monto_estimado,
        l.monto_label AS licitacion_monto_label,
        l.moneda AS licitacion_moneda
      FROM locked
      JOIN device_installations di
        ON di.installation_id = locked.installation_id
      LEFT JOIN notification_preferences np
        ON np.installation_id = di.installation_id
      JOIN notification_events ne
        ON ne.id = locked.notification_event_id
      JOIN licitaciones l
        ON l.id = ne.licitacion_id
    `,
    [limit, workerId]
  );
}

function buildPushInput(delivery: DispatchDeliveryRow): PushNotificationInput {
  const payload = buildNewLicitacionNotificationPayload(
    asDeliveryNotificationContext(delivery),
    delivery.notification_event_id
  );

  return {
    installationId: delivery.installation_id,
    pushToken: delivery.push_token ?? "",
    title: payload.title,
    body: payload.body,
    data: {
      ...payload.data,
      installationId: delivery.installation_id,
      pushProvider: delivery.provider,
      notificationDeliveryId: delivery.delivery_id,
    },
  };
}

async function lockReceiptDeliveries(
  deps: WorkerDependencies,
  workerId: string,
  limit: number
): Promise<ReceiptDeliveryRow[]> {
  return deps.query<ReceiptDeliveryRow>(
    `
      WITH due AS (
        SELECT nd.id
        FROM notification_deliveries nd
        WHERE nd.status = 'sent'
          AND nd.completed_at IS NULL
          AND nd.provider = 'expo'
          AND nd.provider_ticket_id IS NOT NULL
          AND nd.locked_at IS NULL
        ORDER BY nd.last_attempt_at ASC NULLS FIRST, nd.id ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      ),
      locked AS (
        UPDATE notification_deliveries nd
        SET locked_at = NOW(),
            locked_by = $2,
            updated_at = NOW()
        FROM due
        WHERE nd.id = due.id
        RETURNING nd.id AS delivery_id,
                  nd.installation_id,
                  nd.provider_ticket_id,
                  nd.attempt_count
      )
      SELECT * FROM locked
    `,
    [limit, workerId]
  );
}

async function applyReceiptOutcome(
  deps: WorkerDependencies,
  delivery: ReceiptDeliveryRow,
  outcome: PushReceiptOutcome
): Promise<void> {
  await deps.query(
    `
      UPDATE notification_deliveries SET
        status = CASE WHEN $2 = 'sent' THEN status ELSE $2 END,
        provider_receipt_id = $3,
        last_error_code = $4,
        last_error_message = $5,
        next_attempt_at = $6::timestamptz,
        locked_at = NULL,
        locked_by = NULL,
        completed_at = CASE
          WHEN $2 IN ('sent', 'failed', 'invalid') THEN NOW()
          ELSE completed_at
        END,
        updated_at = NOW()
      WHERE id = $1
    `,
    [
      delivery.delivery_id,
      outcome.status,
      outcome.providerReceiptId,
      outcome.errorCode,
      outcome.errorMessage,
      outcome.status === "retryable"
        ? buildExponentialBackoff(delivery.attempt_count + 1)
        : null,
    ]
  );

  if (outcome.status === "invalid") {
    await invalidateInstallation(
      deps,
      delivery.installation_id,
      outcome.errorCode ?? "DeviceNotRegistered"
    );
  }
}

async function releaseDeliveryLock(
  deps: WorkerDependencies,
  deliveryId: number
): Promise<void> {
  await deps.query(
    `
      UPDATE notification_deliveries SET
        locked_at = NULL,
        locked_by = NULL,
        updated_at = NOW()
      WHERE id = $1
    `,
    [deliveryId]
  );
}

export function createRunIngestCycle(
  overrides: Partial<WorkerDependencies> = {}
): () => Promise<WorkerResult> {
  const deps: WorkerDependencies = {
    ...createDefaultDependencies(),
    ...overrides,
  };

  return async function runIngestCycle(): Promise<WorkerResult> {
    const result = emptyWorkerResult();
    const pendingRecords = new Map<string, LicitacionRecord>();

    await ensureLicitacionPartitions(deps);

    try {
      const scrapeResult = await scrapeLicitaciones(20);
      result.found = scrapeResult.items.length;

      const existingSet = await loadExistingCodigos(
        deps,
        scrapeResult.items.map((item) => item.codigoExterno)
      );

      for (const item of scrapeResult.items) {
        if (!existingSet.has(item.codigoExterno)) {
          upsertPendingRecord(pendingRecords, scrapedToRecord(item));
        }
      }
    } catch (error) {
      workerLogger.error("scraper_failed", {
        job: "ingest",
        error_code: "scraper_failed",
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }

    try {
      const today = deps.now();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const [todaySummaries, yesterdaySummaries] = await Promise.all([
        fetchLicitacionesSummary(today),
        fetchLicitacionesSummary(yesterday),
      ]);

      const seen = new Set<string>();
      const summaries = [...todaySummaries, ...yesterdaySummaries].filter(
        (summary) => {
          if (seen.has(summary.CodigoExterno)) return false;
          seen.add(summary.CodigoExterno);
          return true;
        }
      );

      const existingSet = await loadExistingCodigos(
        deps,
        summaries.map((summary) => summary.CodigoExterno)
      );

      const existingRows = await deps.query<{
        codigo_externo: string;
        incompleta: boolean;
      }>(
        `SELECT codigo_externo,
                (organismo_nombre IS NULL OR tipo IS NULL OR monto_estimado IS NULL) AS incompleta
         FROM licitaciones
         WHERE codigo_externo = ANY($1::text[])`,
        [summaries.map((summary) => summary.CodigoExterno)]
      );

      const incompleteSet = new Set(
        existingRows.filter((row) => row.incompleta).map((row) => row.codigo_externo)
      );

      for (const summary of summaries) {
        if (!existingSet.has(summary.CodigoExterno)) {
          const detail = await fetchLicitacionDetail(summary.CodigoExterno);
          upsertPendingRecord(pendingRecords, mapDetailToRecord(summary, detail));
          await deps.sleep(DETAIL_DELAY_MS);
          continue;
        }

        if (!incompleteSet.has(summary.CodigoExterno)) {
          continue;
        }

        const detail = await fetchLicitacionDetail(summary.CodigoExterno);
        const record = mapDetailToRecord(summary, detail);

        await deps.query(
          `UPDATE licitaciones SET
             nombre = $2,
             organismo_nombre = $3,
             tipo = $4,
             monto_estimado = $5,
             monto_label = $6,
             moneda = $7,
             fecha_publicacion = $8::timestamptz,
             fecha_cierre = $9::timestamptz,
             estado = $10,
             url = $11,
             region = $12,
             categoria = $13,
             rubro_code = $14,
             updated_at = NOW()
           WHERE codigo_externo = $1
             AND (organismo_nombre IS NULL OR tipo IS NULL OR monto_estimado IS NULL)`,
          [
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
            record.rubro_code,
          ]
        );
        await deps.sleep(DETAIL_DELAY_MS);
      }

      consecutiveFailures = 0;
    } catch (error) {
      const apiMessage = error instanceof Error ? error.message : "Error desconocido";
      result.errors.push(apiMessage);
      consecutiveFailures++;
      workerLogger.warn("api_unavailable_during_ingest", {
        job: "ingest",
        error_code: "api_unavailable",
        detail: apiMessage,
      });
    }
    for (const record of pendingRecords.values()) {
      const createdAt = deps.now().toISOString();

      const insertResult = await deps.queryResult<Record<string, never>>(
        `
          WITH claimed AS (
            INSERT INTO licitacion_registry (
              codigo_externo,
              licitacion_id,
              created_at,
              updated_at
            )
            VALUES ($2, $1, $16::timestamptz, NOW())
            ON CONFLICT (codigo_externo) DO NOTHING
            RETURNING codigo_externo
          )
          INSERT INTO licitaciones (
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
          )
          SELECT
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9::timestamptz, $10::timestamptz,
            $11, $12, $13, $14, $15,
            FALSE,
            $16::timestamptz,
            NOW()
          WHERE EXISTS (SELECT 1 FROM claimed)
        `,
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
          record.rubro_code,
          createdAt,
        ]
      );

      if ((insertResult.rowCount ?? 0) === 0) {
        continue;
      }

      result.inserted++;

      const eventId = await createNotificationEvent(deps, record);
      const candidateInstallations = await loadCandidateInstallations(
        deps,
        asNotificationContext(record)
      );
      const eligibleInstallations = candidateInstallations.filter((row) =>
        matchesNotificationPreferences(
          asNotificationContext(record),
          buildPreferenceSnapshot(row)
        )
      );

      result.targetsSelected += eligibleInstallations.length;
      result.deliveriesCreated += await createNotificationDeliveries(
        deps,
        eventId,
        eligibleInstallations.map((row) => row.installation_id)
      );
    }

    logObject("[worker][ingest]", {
      found: result.found,
      inserted: result.inserted,
      targetsSelected: result.targetsSelected,
      deliveriesCreated: result.deliveriesCreated,
    });

    return result;
  };
}

export function createRunDispatchCycle(
  overrides: Partial<WorkerDependencies> = {}
): () => Promise<WorkerResult> {
  const deps: WorkerDependencies = {
    ...createDefaultDependencies(),
    ...overrides,
  };

  return async function runDispatchCycle(): Promise<WorkerResult> {
    const result = emptyWorkerResult();
    const deliveries = await lockDispatchDeliveries(
      deps,
      `dispatch:${process.pid}:${Date.now()}`,
      100
    );

    for (const delivery of deliveries) {
      const context = asDeliveryNotificationContext(delivery);
      const preferences = buildPreferenceSnapshot(delivery);

      if (!isInstallationAllowed(delivery)) {
        await markDeliverySkipped(
          deps,
          delivery.delivery_id,
          "failed",
          delivery.invalidated_at
            ? "InstallationInvalidated"
            : "InstallationNotPushCapable",
          delivery.invalidated_at
            ? "La instalación está invalidada"
            : "La instalación no está habilitada para push"
        );
        result.notificationsFailed++;
        continue;
      }

      if (!matchesNotificationPreferences(context, preferences)) {
        await markDeliverySkipped(
          deps,
          delivery.delivery_id,
          "failed",
          "PreferenceMismatch",
          "Las preferencias actuales no coinciden con la licitación"
        );
        result.notificationsFailed++;
        continue;
      }

      const [outcome] = await deps.pushProvider.send([buildPushInput(delivery)]);

      if (!outcome) {
        await markDeliverySkipped(
          deps,
          delivery.delivery_id,
          "failed",
          "MissingDispatchOutcome",
          "No se obtuvo resultado del proveedor"
        );
        result.notificationsFailed++;
        continue;
      }

      await updateDispatchOutcome(deps, delivery, outcome);

      if (outcome.status === "sent") {
        result.notificationsSent++;
        await deps.query(`UPDATE licitaciones SET notificada = TRUE WHERE id = $1`, [
          delivery.licitacion_id,
        ]);
      } else if (outcome.status === "retryable") {
        result.notificationsRetryable++;
      } else if (outcome.status === "invalid") {
        result.notificationsInvalidated++;
        await invalidateInstallation(
          deps,
          delivery.installation_id,
          outcome.errorCode ?? "DeviceNotRegistered"
        );
      } else {
        result.notificationsFailed++;
      }
    }

    logObject("[worker][dispatch]", {
      claimed: deliveries.length,
      sent: result.notificationsSent,
      retryable: result.notificationsRetryable,
      failed: result.notificationsFailed,
      invalidated: result.notificationsInvalidated,
    });

    return result;
  };
}

export function createRunReceiptCycle(
  overrides: Partial<WorkerDependencies> = {}
): () => Promise<WorkerResult> {
  const deps: WorkerDependencies = {
    ...createDefaultDependencies(),
    ...overrides,
  };

  return async function runReceiptCycle(): Promise<WorkerResult> {
    const result = emptyWorkerResult();
    const deliveries = await lockReceiptDeliveries(
      deps,
      `receipt:${process.pid}:${Date.now()}`,
      100
    );

    if (deliveries.length === 0) {
      return result;
    }

    const outcomes = await deps.pushProvider.fetchReceipts(
      deliveries.map((delivery) => delivery.provider_ticket_id)
    );
    const outcomesByTicket = new Map(
      outcomes.map((outcome) => [outcome.providerTicketId, outcome])
    );

    for (const delivery of deliveries) {
      const outcome = outcomesByTicket.get(delivery.provider_ticket_id);
      if (!outcome) {
        await releaseDeliveryLock(deps, delivery.delivery_id);
        continue;
      }

      await applyReceiptOutcome(deps, delivery, outcome);
      result.receiptsProcessed++;

      if (outcome.status === "retryable") {
        result.notificationsRetryable++;
      } else if (outcome.status === "invalid") {
        result.notificationsInvalidated++;
      } else if (outcome.status === "failed") {
        result.notificationsFailed++;
      }
    }

    logObject("[worker][receipt]", {
      processed: result.receiptsProcessed,
      retryable: result.notificationsRetryable,
      invalidated: result.notificationsInvalidated,
      failed: result.notificationsFailed,
    });

    return result;
  };
}

export function createRunCleanupCycle(
  overrides: Partial<WorkerDependencies> = {}
): () => Promise<WorkerResult> {
  const deps: WorkerDependencies = {
    ...createDefaultDependencies(),
    ...overrides,
  };

  return async function runCleanupCycle(): Promise<WorkerResult> {
    const result = emptyWorkerResult();

    await ensureLicitacionPartitions(deps);
    result.archivedLicitaciones = await archiveOldLicitaciones(deps);
    result.archivedDeliveries = await archiveOldDeliveries(deps);

    logObject("[worker][cleanup]", {
      archivedLicitaciones: result.archivedLicitaciones,
      archivedDeliveries: result.archivedDeliveries,
    });

    return result;
  };
}

export function createRunArchiveExportCycle(
  overrides: Partial<WorkerDependencies> = {}
): () => Promise<WorkerResult> {
  const deps: WorkerDependencies = {
    ...createDefaultDependencies(),
    ...overrides,
  };

  return async function runArchiveExportCycle(): Promise<WorkerResult> {
    const result = emptyWorkerResult();
    const summary = await runArchiveExportJob({
      query: deps.query,
      queryResult: deps.queryResult,
      now: deps.now,
    });

    result.archiveExports = summary.exported;
    result.archiveVerified = summary.verified;
    result.archiveDropped = summary.dropped;

    if (summary.exported > 0) {
      observeArchiveExport("archive", "exported", summary.exported);
    }
    if (summary.verified > 0) {
      observeArchiveExport("archive", "verified", summary.verified);
    }
    if (summary.failed > 0) {
      observeArchiveExport("archive", "failed", summary.failed);
      result.errors.push(`Archive export failures: ${summary.failed}`);
    }
    if (summary.dropped > 0) {
      observeArchiveExport("archive", "dropped", summary.dropped);
    }

    logObject("[worker][archive_export]", {
      exported: summary.exported,
      verified: summary.verified,
      dropped: summary.dropped,
      failed: summary.failed,
    });

    return result;
  };
}

async function startRun(
  deps: WorkerDependencies,
  workerName: string
): Promise<number | undefined> {
  const rows = await deps.query<{ id: number }>(
    `INSERT INTO worker_runs (started_at, worker_name) VALUES ($1, $2) RETURNING id`,
    [deps.now(), workerName]
  );

  return rows[0]?.id;
}

async function finishRun(
  deps: WorkerDependencies,
  workerName: string,
  runId: number | undefined,
  result: WorkerResult
): Promise<void> {
  if (!runId) return;

  await deps.query(
    `UPDATE worker_runs SET
       finished_at = NOW(),
       worker_name = $1,
       licitaciones_found = $2,
       licitaciones_new = $3,
       notifications_sent = $4,
       notifications_retryable = $5,
       notifications_failed = $6,
       notifications_invalidated = $7,
       targets_selected = $8,
       deliveries_created = $9,
       receipts_processed = $10,
       archived_licitaciones = $11,
       archived_deliveries = $12,
       error_message = $13
     WHERE id = $14`,
    [
      workerName,
      result.found,
      result.inserted,
      result.notificationsSent,
      result.notificationsRetryable,
      result.notificationsFailed,
      result.notificationsInvalidated,
      result.targetsSelected,
      result.deliveriesCreated,
      result.receiptsProcessed,
      result.archivedLicitaciones,
      result.archivedDeliveries,
      result.errors.length > 0 ? result.errors.join("; ") : null,
      runId,
    ]
  );
}

function createTrackedRunner(
  workerName: string,
  runnerFactory: (overrides?: Partial<WorkerDependencies>) => () => Promise<WorkerResult>,
  overrides: Partial<WorkerDependencies> = {}
): () => Promise<WorkerResult> {
  const deps: WorkerDependencies = {
    ...createDefaultDependencies(),
    ...overrides,
  };
  const runner = runnerFactory(deps);

  return async () => {
    let runId: number | undefined;
    let result = emptyWorkerResult();
    const startedAt = Date.now();

    try {
      workerLogger.info("worker_run_started", {
        job: workerName,
        started_at: deps.now().toISOString(),
      });
      runId = await startRun(deps, workerName);
      result = await runner();
      observeWorkerRun(workerName, "success", Date.now() - startedAt, result);
      return result;
    } catch (error) {
      result.errors.push(
        error instanceof Error ? error.message : "Error desconocido"
      );
      captureException(error, { job: workerName, runId });
      workerLogger.error("worker_run_failed", {
        job: workerName,
        run_id: runId,
        duration_ms: Date.now() - startedAt,
        error_code: "worker_run_failed",
        error: error instanceof Error ? error : new Error(String(error)),
      });
      observeWorkerRun(workerName, "error", Date.now() - startedAt, result);
      return result;
    } finally {
      await finishRun(deps, workerName, runId, result);
    }
  };
}

export function createRunSyncCycle(
  overrides: Partial<WorkerDependencies> = {}
): () => Promise<WorkerResult> {
  const runIngest = createTrackedRunner("ingest", createRunIngestCycle, overrides);
  const runDispatch = createTrackedRunner(
    "dispatch",
    createRunDispatchCycle,
    overrides
  );
  const runReceipt = createTrackedRunner(
    "receipt",
    createRunReceiptCycle,
    overrides
  );
  const runCleanup = createTrackedRunner(
    "cleanup",
    createRunCleanupCycle,
    overrides
  );
  const runArchiveExport = createTrackedRunner(
    "archive_export",
    createRunArchiveExportCycle,
    overrides
  );

  return async function runSyncCycle(): Promise<WorkerResult> {
    const ingest = await runIngest();
    const dispatch = await runDispatch();
    const receipt = await runReceipt();
    const cleanup = await runCleanup();
    const archiveExport = await runArchiveExport();

    return mergeResults(ingest, dispatch, receipt, cleanup, archiveExport);
  };
}

export const runIngestCycle = createTrackedRunner("ingest", createRunIngestCycle);
export const runDispatchCycle = createTrackedRunner(
  "dispatch",
  createRunDispatchCycle
);
export const runReceiptCycle = createTrackedRunner(
  "receipt",
  createRunReceiptCycle
);
export const runCleanupCycle = createTrackedRunner(
  "cleanup",
  createRunCleanupCycle
);
export const runArchiveExportCycle = createTrackedRunner(
  "archive_export",
  createRunArchiveExportCycle
);
export const runSyncCycle = createRunSyncCycle();
