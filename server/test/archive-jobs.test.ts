import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getArchiveStorageConfigMock,
  uploadArchiveObjectMock,
  verifyArchiveObjectMetadataMock,
  buildArchiveObjectKeyMock,
} = vi.hoisted(() => ({
  getArchiveStorageConfigMock: vi.fn(),
  uploadArchiveObjectMock: vi.fn(),
  verifyArchiveObjectMetadataMock: vi.fn(),
  buildArchiveObjectKeyMock: vi.fn(),
}));

vi.mock("../src/archive-storage", () => ({
  getArchiveStorageConfig: getArchiveStorageConfigMock,
  uploadArchiveObject: uploadArchiveObjectMock,
  verifyArchiveObjectMetadata: verifyArchiveObjectMetadataMock,
  buildArchiveObjectKey: buildArchiveObjectKeyMock,
  computeChecksum: (rows: Record<string, unknown>[]) => `checksum-${rows.length}`,
}));

describe("archive jobs", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    getArchiveStorageConfigMock.mockReturnValue({
      bucket: "bucket",
      prefix: "prefix",
      region: "us-east-1",
    });
    buildArchiveObjectKeyMock.mockReturnValue("prefix/lic/2025/03/export.parquet");
    uploadArchiveObjectMock.mockResolvedValue({
      objectKey: "prefix/lic/2025/03/export.parquet",
    });
    verifyArchiveObjectMetadataMock.mockResolvedValue(true);
  });

  it("exporta y verifica manifiestos pendientes", async () => {
    const writes: Array<{ sql: string; params?: unknown[] }> = [];
    const { runArchiveExportCycle } = await import("../src/archive-jobs");

    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM archive.licitaciones") && sql.includes("GROUP BY 2")) {
        return [
          {
            entity: "licitaciones",
            partition_month: "2025-03",
            row_count: 1,
            min_created_at: "2025-03-01T00:00:00.000Z",
            max_created_at: "2025-03-15T00:00:00.000Z",
          },
        ];
      }
      if (sql.includes("FROM archive.notification_deliveries") && sql.includes("GROUP BY 2")) {
        return [];
      }
      if (sql.includes("FROM archive_exports") && sql.includes("status IN ('verified', 'dropped')")) {
        return [];
      }
      if (sql.includes("FROM archive.licitaciones") && sql.includes("ORDER BY created_at")) {
        return [
          {
            id: "LIC-1",
            codigo_externo: "LIC-1",
            nombre: "Licitación 1",
            organismo_nombre: "MOP",
            tipo: "LE",
            monto_estimado: "1000",
            monto_label: null,
            moneda: "CLP",
            fecha_publicacion: "2025-03-01T00:00:00.000Z",
            fecha_cierre: "2025-03-15T00:00:00.000Z",
            estado: "Publicada",
            url: "https://example.com",
            region: "RM",
            categoria: "General",
            rubro_code: "45000000",
            notificada: false,
            created_at: "2025-03-01T00:00:00.000Z",
            updated_at: "2025-03-01T00:00:00.000Z",
          },
        ];
      }
      if (sql.includes("WHERE status = 'verified'")) {
        return [];
      }
      return [];
    });

    const queryResult = vi.fn(async (sql: string, params?: unknown[]) => {
      writes.push({ sql, params });
      return {
        rowCount: 1,
        rows: [],
        command: "INSERT",
        oid: 0,
        fields: [],
      };
    });

    const summary = await runArchiveExportCycle({
      query: query as never,
      queryResult: queryResult as never,
    });

    expect(summary.exported).toBe(1);
    expect(summary.verified).toBe(1);
    expect(summary.failed).toBe(0);
    expect(uploadArchiveObjectMock).toHaveBeenCalledTimes(1);
    expect(verifyArchiveObjectMetadataMock).toHaveBeenCalledTimes(1);
    expect(writes.some((entry) => entry.sql.includes("INSERT INTO archive_exports"))).toBe(true);
  });
});
