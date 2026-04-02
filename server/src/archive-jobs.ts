import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ParquetReader, ParquetSchema, ParquetWriter } from "parquetjs-lite";
import type { QueryResult } from "pg";
import { createDirectPool } from "./db";
import {
  buildArchiveObjectKey,
  computeChecksum,
  downloadArchiveObject,
  getArchiveStorageConfig,
  uploadArchiveObject,
  verifyArchiveObjectMetadata,
} from "./archive-storage";

type QueryFn = <T extends Record<string, unknown>>(
  text: string,
  params?: unknown[]
) => Promise<T[]>;

type QueryResultFn = <T extends Record<string, unknown>>(
  text: string,
  params?: unknown[]
) => Promise<QueryResult<T>>;

export type ArchiveEntity = "licitaciones" | "notification_deliveries";

interface ArchiveCandidate extends Record<string, unknown> {
  entity: ArchiveEntity;
  partition_month: string;
  row_count: number | string;
  min_created_at: Date | string | null;
  max_created_at: Date | string | null;
}

interface ArchiveManifestRow extends Record<string, unknown> {
  id: number;
  entity: ArchiveEntity;
  partition_month: string;
  object_key: string;
  row_count: number | string;
  checksum: string;
  status: string;
}

export interface ArchiveExportSummary {
  exported: number;
  verified: number;
  dropped: number;
  failed: number;
}

const licitacionesParquetSchema = new ParquetSchema({
  id: { type: "UTF8" },
  codigo_externo: { type: "UTF8" },
  nombre: { type: "UTF8" },
  organismo_nombre: { type: "UTF8", optional: true },
  tipo: { type: "UTF8", optional: true },
  monto_estimado: { type: "UTF8", optional: true },
  monto_label: { type: "UTF8", optional: true },
  moneda: { type: "UTF8" },
  fecha_publicacion: { type: "TIMESTAMP_MILLIS", optional: true },
  fecha_cierre: { type: "TIMESTAMP_MILLIS", optional: true },
  estado: { type: "UTF8" },
  url: { type: "UTF8", optional: true },
  region: { type: "UTF8", optional: true },
  categoria: { type: "UTF8" },
  rubro_code: { type: "UTF8", optional: true },
  notificada: { type: "BOOLEAN" },
  created_at: { type: "TIMESTAMP_MILLIS" },
  updated_at: { type: "TIMESTAMP_MILLIS" },
});

const deliveriesParquetSchema = new ParquetSchema({
  id: { type: "INT64" },
  notification_event_id: { type: "INT64" },
  installation_id: { type: "UTF8" },
  provider: { type: "UTF8" },
  status: { type: "UTF8" },
  next_attempt_at: { type: "TIMESTAMP_MILLIS", optional: true },
  locked_at: { type: "TIMESTAMP_MILLIS", optional: true },
  locked_by: { type: "UTF8", optional: true },
  completed_at: { type: "TIMESTAMP_MILLIS", optional: true },
  provider_ticket_id: { type: "UTF8", optional: true },
  provider_receipt_id: { type: "UTF8", optional: true },
  attempt_count: { type: "INT64" },
  last_error_code: { type: "UTF8", optional: true },
  last_error_message: { type: "UTF8", optional: true },
  last_attempt_at: { type: "TIMESTAMP_MILLIS", optional: true },
  created_at: { type: "TIMESTAMP_MILLIS" },
  updated_at: { type: "TIMESTAMP_MILLIS" },
});

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeRows(
  entity: ArchiveEntity,
  rows: Record<string, unknown>[]
): Record<string, unknown>[] {
  return rows.map((row) => {
    const normalized = { ...row };

    Object.entries(normalized).forEach(([key, value]) => {
      if (value instanceof Date) {
        normalized[key] = value;
        return;
      }

      if (typeof value === "number" || typeof value === "boolean" || value === null) {
        return;
      }

      if (
        key.endsWith("_at") ||
        key === "fecha_publicacion" ||
        key === "fecha_cierre"
      ) {
        normalized[key] = value ? new Date(String(value)) : null;
        return;
      }

      if (
        entity === "notification_deliveries" &&
        (key === "id" || key === "notification_event_id" || key === "attempt_count")
      ) {
        normalized[key] = Number(value);
        return;
      }

      if (entity === "licitaciones" && key === "monto_estimado") {
        normalized[key] = value == null ? null : String(value);
        return;
      }

      normalized[key] = value == null ? null : String(value);
    });

    return normalized;
  });
}

async function writeParquet(
  entity: ArchiveEntity,
  rows: Record<string, unknown>[]
): Promise<string> {
  const tempFile = path.join(
    os.tmpdir(),
    `notichilec-${entity}-${Date.now()}-${randomUUID()}.parquet`
  );

  const writer = await ParquetWriter.openFile(
    entity === "licitaciones" ? licitacionesParquetSchema : deliveriesParquetSchema,
    tempFile
  );

  try {
    for (const row of normalizeRows(entity, rows)) {
      await writer.appendRow(row);
    }
  } finally {
    await writer.close();
  }

  return tempFile;
}

export async function findArchiveCandidates(query: QueryFn): Promise<ArchiveCandidate[]> {
  const licitaciones = await query<ArchiveCandidate>(
    `
      SELECT
        'licitaciones'::text AS entity,
        TO_CHAR(date_trunc('month', created_at), 'YYYY-MM') AS partition_month,
        COUNT(*)::int AS row_count,
        MIN(created_at) AS min_created_at,
        MAX(created_at) AS max_created_at
      FROM archive.licitaciones
      GROUP BY 2
      HAVING COUNT(*) > 0
    `
  );

  const deliveries = await query<ArchiveCandidate>(
    `
      SELECT
        'notification_deliveries'::text AS entity,
        TO_CHAR(date_trunc('month', COALESCE(completed_at, created_at)), 'YYYY-MM') AS partition_month,
        COUNT(*)::int AS row_count,
        MIN(COALESCE(completed_at, created_at)) AS min_created_at,
        MAX(COALESCE(completed_at, created_at)) AS max_created_at
      FROM archive.notification_deliveries
      GROUP BY 2
      HAVING COUNT(*) > 0
    `
  );

  return [...licitaciones, ...deliveries];
}

async function findVerifiedManifest(
  query: QueryFn,
  entity: ArchiveEntity,
  partitionMonth: string
): Promise<ArchiveManifestRow | null> {
  const rows = await query<ArchiveManifestRow>(
    `
      SELECT *
      FROM archive_exports
      WHERE entity = $1
        AND partition_month = $2
        AND status IN ('verified', 'dropped')
      ORDER BY exported_at DESC
      LIMIT 1
    `,
    [entity, partitionMonth]
  );

  return rows[0] ?? null;
}

async function loadArchiveRows(
  query: QueryFn,
  entity: ArchiveEntity,
  partitionMonth: string
): Promise<Record<string, unknown>[]> {
  if (entity === "licitaciones") {
    return query<Record<string, unknown>>(
      `
        SELECT *
        FROM archive.licitaciones
        WHERE TO_CHAR(date_trunc('month', created_at), 'YYYY-MM') = $1
        ORDER BY created_at ASC, id ASC
      `,
      [partitionMonth]
    );
  }

  return query<Record<string, unknown>>(
    `
      SELECT *
      FROM archive.notification_deliveries
      WHERE TO_CHAR(date_trunc('month', COALESCE(completed_at, created_at)), 'YYYY-MM') = $1
      ORDER BY COALESCE(completed_at, created_at) ASC, id ASC
    `,
    [partitionMonth]
  );
}

async function upsertArchiveManifest(
  queryResult: QueryResultFn,
  payload: {
    entity: ArchiveEntity;
    partitionMonth: string;
    objectKey: string;
    rowCount: number;
    minCreatedAt: Date | null;
    maxCreatedAt: Date | null;
    checksum: string;
    status: string;
    exportedAt?: Date;
    verifiedAt?: Date | null;
    dropEligibleAt?: Date | null;
    lastError?: string | null;
    droppedAt?: Date | null;
  }
): Promise<void> {
  await queryResult(
    `
      INSERT INTO archive_exports (
        entity,
        partition_month,
        object_key,
        row_count,
        min_created_at,
        max_created_at,
        checksum,
        status,
        exported_at,
        verified_at,
        drop_eligible_at,
        last_error,
        dropped_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        COALESCE($9, NOW()),
        $10,
        $11,
        $12,
        $13
      )
      ON CONFLICT (entity, partition_month) DO UPDATE SET
        object_key = EXCLUDED.object_key,
        row_count = EXCLUDED.row_count,
        min_created_at = EXCLUDED.min_created_at,
        max_created_at = EXCLUDED.max_created_at,
        checksum = EXCLUDED.checksum,
        status = EXCLUDED.status,
        exported_at = COALESCE(EXCLUDED.exported_at, archive_exports.exported_at),
        verified_at = EXCLUDED.verified_at,
        drop_eligible_at = EXCLUDED.drop_eligible_at,
        last_error = EXCLUDED.last_error,
        dropped_at = EXCLUDED.dropped_at,
        updated_at = NOW()
    `,
    [
      payload.entity,
      payload.partitionMonth,
      payload.objectKey,
      payload.rowCount,
      payload.minCreatedAt,
      payload.maxCreatedAt,
      payload.checksum,
      payload.status,
      payload.exportedAt ?? null,
      payload.verifiedAt ?? null,
      payload.dropEligibleAt ?? null,
      payload.lastError ?? null,
      payload.droppedAt ?? null,
    ]
  );
}

function buildObjectMetadata(entity: ArchiveEntity, partitionMonth: string, rowCount: number, checksum: string) {
  return {
    entity,
    partition_month: partitionMonth,
    row_count: String(rowCount),
    checksum,
  };
}

export async function runArchiveExportCycle(
  deps: {
    query: QueryFn;
    queryResult: QueryResultFn;
    now?: () => Date;
  }
): Promise<ArchiveExportSummary> {
  const storageConfig = getArchiveStorageConfig();
  if (!storageConfig) {
    return { exported: 0, verified: 0, dropped: 0, failed: 0 };
  }

  const now = deps.now ?? (() => new Date());
  const summary: ArchiveExportSummary = {
    exported: 0,
    verified: 0,
    dropped: 0,
    failed: 0,
  };

  const candidates = await findArchiveCandidates(deps.query);

  for (const candidate of candidates) {
    const entity = candidate.entity;
    const partitionMonth = String(candidate.partition_month);

    const existing = await findVerifiedManifest(deps.query, entity, partitionMonth);
    if (existing) {
      continue;
    }

    const rows = await loadArchiveRows(deps.query, entity, partitionMonth);
    const rowCount = rows.length;
    if (rowCount === 0) {
      continue;
    }

    const checksum = computeChecksum(rows);
    const tempFile = await writeParquet(entity, rows);
    const objectKey = buildArchiveObjectKey(
      storageConfig,
      entity,
      partitionMonth,
      checksum.slice(0, 16)
    );
    const metadata = buildObjectMetadata(entity, partitionMonth, rowCount, checksum);

    try {
      await uploadArchiveObject(storageConfig, tempFile, objectKey, metadata);
      summary.exported += 1;

      await upsertArchiveManifest(deps.queryResult, {
        entity,
        partitionMonth,
        objectKey,
        rowCount,
        minCreatedAt: toDate(candidate.min_created_at),
        maxCreatedAt: toDate(candidate.max_created_at),
        checksum,
        status: "exported",
        exportedAt: now(),
      });

      const verified = await verifyArchiveObjectMetadata(storageConfig, objectKey, metadata);
      if (!verified) {
        summary.failed += 1;
        await upsertArchiveManifest(deps.queryResult, {
          entity,
          partitionMonth,
          objectKey,
          rowCount,
          minCreatedAt: toDate(candidate.min_created_at),
          maxCreatedAt: toDate(candidate.max_created_at),
          checksum,
          status: "failed",
          lastError: "archive_metadata_mismatch",
        });
        continue;
      }

      summary.verified += 1;
      await upsertArchiveManifest(deps.queryResult, {
        entity,
        partitionMonth,
        objectKey,
        rowCount,
        minCreatedAt: toDate(candidate.min_created_at),
        maxCreatedAt: toDate(candidate.max_created_at),
        checksum,
        status: "verified",
        verifiedAt: now(),
        dropEligibleAt: new Date(now().getTime() + 30 * 24 * 60 * 60 * 1000),
      });
    } catch (error) {
      summary.failed += 1;
      await upsertArchiveManifest(deps.queryResult, {
        entity,
        partitionMonth,
        objectKey,
        rowCount,
        minCreatedAt: toDate(candidate.min_created_at),
        maxCreatedAt: toDate(candidate.max_created_at),
        checksum,
        status: "failed",
        lastError: error instanceof Error ? error.message : "archive_export_failed",
      });
    } finally {
      await fs.unlink(tempFile).catch(() => undefined);
    }
  }

  const dropCandidates = await deps.query<ArchiveManifestRow>(
    `
      SELECT *
      FROM archive_exports
      WHERE status = 'verified'
        AND drop_eligible_at IS NOT NULL
        AND drop_eligible_at <= NOW()
      ORDER BY entity, partition_month
    `
  );

  for (const candidate of dropCandidates) {
    if (candidate.entity === "licitaciones") {
      await deps.queryResult(
        `
          DELETE FROM archive.licitaciones
          WHERE TO_CHAR(date_trunc('month', created_at), 'YYYY-MM') = $1
        `,
        [candidate.partition_month]
      );
    } else {
      await deps.queryResult(
        `
          DELETE FROM archive.notification_deliveries
          WHERE TO_CHAR(date_trunc('month', COALESCE(completed_at, created_at)), 'YYYY-MM') = $1
        `,
        [candidate.partition_month]
      );
    }

    summary.dropped += 1;
    await upsertArchiveManifest(deps.queryResult, {
      entity: candidate.entity,
      partitionMonth: candidate.partition_month,
      objectKey: candidate.object_key,
      rowCount: Number(candidate.row_count),
      minCreatedAt: null,
      maxCreatedAt: null,
      checksum: candidate.checksum,
      status: "dropped",
      droppedAt: now(),
    });
  }

  return summary;
}

export async function restoreArchivePartition(options: {
  entity: ArchiveEntity;
  partitionMonth: string;
  tempTableName?: string;
}): Promise<{ tableName: string; rowCount: number }> {
  const storageConfig = getArchiveStorageConfig();
  if (!storageConfig) {
    throw new Error("archive_storage_not_configured");
  }

  const directPool = createDirectPool("notichilec-archive-restore");
  try {
    const rows = await directPool.query<ArchiveManifestRow>(
      `
        SELECT *
        FROM archive_exports
        WHERE entity = $1
          AND partition_month = $2
          AND status IN ('verified', 'dropped')
        ORDER BY exported_at DESC
        LIMIT 1
      `,
      [options.entity, options.partitionMonth]
    );

    const manifest = rows.rows[0];
    if (!manifest) {
      throw new Error("archive_manifest_not_found");
    }

    const filePath = await downloadArchiveObject(storageConfig, manifest.object_key);
    const reader = await ParquetReader.openFile(filePath);
    const cursor = reader.getCursor();
    const tableName =
      options.tempTableName ||
      `audit_restore_${options.entity.replace(/[^a-z_]/gi, "_")}_${options.partitionMonth.replace(
        /[^0-9]/g,
        "_"
      )}`;

    await directPool.query(
      `CREATE TEMP TABLE ${tableName} (LIKE ${
        options.entity === "licitaciones"
          ? "archive.licitaciones"
          : "archive.notification_deliveries"
      } INCLUDING DEFAULTS) ON COMMIT PRESERVE ROWS`
    );

    let rowCount = 0;
    try {
      while (true) {
        const row = await cursor.next();
        if (!row) break;

        const entries = Object.entries(row);
        const columns = entries.map(([column]) => column);
        const values = entries.map(([, value]) => value ?? null);
        const placeholders = entries.map((_, index) => `$${index + 1}`);
        await directPool.query(
          `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`,
          values
        );
        rowCount += 1;
      }
    } finally {
      await reader.close();
      await fs.unlink(filePath).catch(() => undefined);
    }

    return { tableName, rowCount };
  } finally {
    await directPool.end();
  }
}
