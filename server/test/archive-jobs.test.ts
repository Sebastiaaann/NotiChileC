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

    const drizzleConfig = {
        casing: { getColumnCasing: () => undefined },
        escapeName: (name: string) => `"${name}"`,
        escapeParam: (num: number) => `$${num + 1}`,
        escapeString: (str: string) => `'${str.replace(/'/g, "''")}'`,
        prepareTyping: () => "none" as const,
      };
      const drizzleSqlText = (s: any): string =>
        typeof s === "string" ? s : (s?.SQL ?? (s?.toQuery ? s.toQuery(drizzleConfig).sql : String(s)));

      const query = vi.fn(async (sql: any, params: unknown[] = []) => {
      const sqlText = drizzleSqlText(sql);
      if (sqlText.includes("FROM archive.licitaciones") && sqlText.includes("GROUP BY 2")) {
        return {
          rows: [
            {
              entity: "licitaciones",
              partition_month: "2025-03",
              row_count: 1,
              min_created_at: "2025-03-01T00:00:00.000Z",
              max_created_at: "2025-03-15T00:00:00.000Z",
            },
          ],
          rowCount: 1, command: "", oid: 0, fields: [],
        };
      }
      if (sqlText.includes("FROM archive.notification_deliveries") && sqlText.includes("GROUP BY 2")) {
        return { rows: [], rowCount: 0, command: "", oid: 0, fields: [] };
      }
      if (sqlText.includes("FROM archive_exports") && sqlText.includes("status IN ('verified', 'dropped')")) {
        return { rows: [], rowCount: 0, command: "", oid: 0, fields: [] };
      }
      if (sqlText.includes("FROM archive.licitaciones") && sqlText.includes("ORDER BY created_at")) {
        return {
          rows: [
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
          ],
          rowCount: 1, command: "", oid: 0, fields: [],
        };
      }
      if (sqlText.includes("WHERE status = 'verified'")) {
        return { rows: [], rowCount: 0, command: "", oid: 0, fields: [] };
      }
      writes.push({ sql: sqlText, params });
      return { rows: [], rowCount: 0, command: "", oid: 0, fields: [] };
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
      db: {
        execute: query as never,
      },
      now: () => new Date("2026-04-02"),
    });

    expect(summary.exported).toBe(1);
    expect(summary.verified).toBe(1);
    expect(summary.failed).toBe(0);
    expect(uploadArchiveObjectMock).toHaveBeenCalledTimes(1);
    expect(verifyArchiveObjectMetadataMock).toHaveBeenCalledTimes(1);
    expect(writes.some((entry) => entry.sql.includes("INSERT INTO archive_exports"))).toBe(true);
  });
});
