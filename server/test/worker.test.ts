import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  queryMock,
  queryResultMock,
  scrapeLicitacionesMock,
  scrapedToRecordMock,
  fetchLicitacionesSummaryMock,
  fetchLicitacionDetailMock,
  mapDetailToRecordMock,
  pushSendMock,
  pushFetchReceiptsMock,
} = vi.hoisted(() => ({
  queryMock: vi.fn(),
  queryResultMock: vi.fn(),
  scrapeLicitacionesMock: vi.fn(),
  scrapedToRecordMock: vi.fn(),
  fetchLicitacionesSummaryMock: vi.fn(),
  fetchLicitacionDetailMock: vi.fn(),
  mapDetailToRecordMock: vi.fn(),
  pushSendMock: vi.fn(),
  pushFetchReceiptsMock: vi.fn(),
}));

const drizzleToQueryConfig = {
  casing: { getColumnCasing: (col: any) => col.name },
  escapeName: (name: string) => `"${name}"`,
  escapeParam: (num: number) => `$${num + 1}`,
  escapeString: (str: string) => `'${str.replace(/'/g, "''")}'`,
  prepareTyping: () => "none" as const,
};
function drizzleSqlText(sql: any): string {
  if (typeof sql === "string") return sql;
  if (sql?.SQL) return sql.SQL;
  if (sql?.toQuery) return sql.toQuery(drizzleToQueryConfig).sql;
  return String(sql);
}

vi.mock("../src/db", () => ({
  query: queryMock,
  queryResult: queryResultMock,
  db: {
    select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve([]) }) })),
    insert: vi.fn(() => ({ values: () => ({ returning: () => Promise.resolve([{}]) }) })),
    update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve(undefined) }) })),
    execute: vi.fn(async (sql: any) => {
      const sqlText = drizzleSqlText(sql);
      const result = await queryResultMock(sqlText);
      if (result && typeof result === "object" && "rows" in result) {
        return result;
      }
      const rows = await queryMock(sqlText).catch(() => []);
      return { rows: Array.isArray(rows) ? rows : [], rowCount: Array.isArray(rows) ? rows.length : 0, command: "", oid: 0, fields: [] };
    }),
  },
}));

vi.mock("../src/scraper", () => ({
  scrapeLicitaciones: scrapeLicitacionesMock,
  scrapedToRecord: scrapedToRecordMock,
}));

vi.mock("../src/chilecompra", () => ({
  fetchLicitacionesSummary: fetchLicitacionesSummaryMock,
  fetchLicitacionDetail: fetchLicitacionDetailMock,
  mapDetailToRecord: mapDetailToRecordMock,
}));

import {
  createRunCleanupCycle,
  createRunDispatchCycle,
  createRunIngestCycle,
  createRunReceiptCycle,
} from "../src/worker";
import type { PushProvider } from "../src/push-provider";

function createPushProviderMock(): PushProvider {
  return {
    name: "mock",
    send: pushSendMock,
    fetchReceipts: pushFetchReceiptsMock,
  };
}

describe("workers", () => {
  const fixedNow = new Date("2026-04-02T12:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();

    scrapeLicitacionesMock.mockResolvedValue({ items: [], source: "scraper", total: 0 });
    fetchLicitacionesSummaryMock.mockResolvedValue([]);
    fetchLicitacionDetailMock.mockResolvedValue({});
    scrapedToRecordMock.mockReturnValue(undefined);
    mapDetailToRecordMock.mockReturnValue(undefined);

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("ensure_licitaciones_monthly_partitions")) return [];
      if (sql.includes("archive_old_licitaciones")) return [{ archived_count: 0 }];
      if (sql.includes("archive_old_notification_deliveries")) return [{ archived_count: 0 }];
      if (sql.includes("SELECT codigo_externo FROM licitacion_registry")) return [];
      if (sql.includes("SELECT codigo_externo,") && sql.includes("incompleta")) return [];
      if (sql.includes("INSERT INTO notification_events")) return [{ id: 77 }];
      if (sql.includes("FROM device_installations di") && !sql.includes("JOIN notification_events")) {
        return [];
      }
      if (sql.includes("WITH due AS") && sql.includes("JOIN notification_events")) {
        return [];
      }
      if (sql.includes("WITH due AS") && sql.includes("provider_ticket_id")) {
        return [];
      }
      if (sql.includes("UPDATE notification_deliveries SET")) return [];
      if (sql.includes("UPDATE device_installations SET")) return [];
      if (sql.includes("UPDATE licitaciones SET notificada = TRUE")) return [];
      return [];
    });

    queryResultMock.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO licitaciones")) return { rowCount: 1, rows: [] };
      if (sql.includes("INSERT INTO notification_deliveries")) return { rowCount: 1, rows: [] };
      return { rowCount: 0, rows: [] };
    });
  });

  it("ingest crea deliveries para instalaciones elegibles", async () => {
    scrapeLicitacionesMock.mockResolvedValue({
      items: [{ codigoExterno: "123-LE1" }],
      source: "scraper",
      total: 1,
    });

    scrapedToRecordMock.mockReturnValue({
      id: "123-LE1",
      codigo_externo: "123-LE1",
      nombre: "Desde scraper",
      organismo_nombre: "MOP",
      tipo: "LE",
      monto_estimado: 120000000,
      monto_label: null,
      moneda: "CLP",
      fecha_publicacion: "2026-04-02T12:00:00.000Z",
      fecha_cierre: "2026-04-03T12:00:00.000Z",
      estado: "Publicada",
      url: "https://example.com",
      region: "RM",
      categoria: "45000000",
      rubro_code: "45000000",
      source_rank: null,
    });

    queryResultMock.mockResolvedValue({ rows: [{ id: 77 }], rowCount: 1, command: "", oid: 0, fields: [] });

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("ensure_licitaciones_monthly_partitions")) return [];
      if (sql.includes("SELECT codigo_externo FROM licitacion_registry")) return [];
      if (sql.includes("FROM device_installations di") && !sql.includes("JOIN notification_events")) {
        return [
          {
            installation_id: "inst-eligible",
            push_token: "ExponentPushToken[eligible-token]",
            platform: "ios",
            environment: "development",
            app_version: "1.0.0",
            push_capable: true,
            permission_status: "granted",
            active: true,
            invalidated_at: null,
            invalid_reason: null,
            last_seen_at: fixedNow.toISOString(),
            enabled: true,
            rubro: "45000000",
            tipo: "LE",
            region: "RM",
            monto_min: 100000000,
            monto_max: null,
          },
        ];
      }
      return [];
    });

    const runIngestCycle = createRunIngestCycle({
      query: queryMock,
      queryResult: queryResultMock,
      pushProvider: createPushProviderMock(),
      now: () => fixedNow,
      sleep: async () => undefined,
    });

    const result = await runIngestCycle();

    expect(result.inserted).toBe(1);
    expect(result.targetsSelected).toBe(1);
    expect(result.deliveriesCreated).toBe(1);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("SET source_rank = $2"),
      ["123-LE1", 1, expect.any(String)]
    );
  });

  it("dispatch toma deliveries pendientes con SKIP LOCKED y actualiza envíos", async () => {
    queryResultMock.mockResolvedValue({
      rows: [
        {
          delivery_id: 10,
          notification_event_id: 77,
          installation_id: "inst-eligible",
          provider: "expo",
          status: "pending",
          provider_ticket_id: null,
          provider_receipt_id: null,
          attempt_count: 0,
          push_token: "ExponentPushToken[eligible-token]",
          platform: "ios",
          environment: "development",
          app_version: "1.0.0",
          push_capable: true,
          permission_status: "granted",
          active: true,
          invalidated_at: null,
          invalid_reason: null,
          last_seen_at: fixedNow.toISOString(),
          enabled: true,
          rubro: "45000000",
          tipo: "LE",
          region: "RM",
          monto_min: 100000000,
          monto_max: null,
          licitacion_id: "123-LE1",
          licitacion_nombre: "Nueva licitación",
          licitacion_codigo_externo: "123-LE1",
          licitacion_tipo: "LE",
          licitacion_region: "RM",
          licitacion_rubro_code: "45000000",
          licitacion_monto_estimado: 120000000,
          licitacion_monto_label: null,
          licitacion_moneda: "CLP",
        },
      ],
    });

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("UPDATE notification_deliveries SET")) return [];
      if (sql.includes("UPDATE licitaciones SET notificada = TRUE")) return [];
      return [];
    });

    pushSendMock.mockResolvedValue([
      {
        installationId: "inst-eligible",
        pushToken: "ExponentPushToken[eligible-token]",
        status: "sent",
        providerTicketId: "ticket-1",
        providerReceiptId: null,
        errorCode: null,
        errorMessage: null,
      },
    ]);

    const runDispatchCycle = createRunDispatchCycle({
      query: queryMock,
      queryResult: queryResultMock,
      pushProvider: createPushProviderMock(),
      now: () => fixedNow,
      sleep: async () => undefined,
    });

    const result = await runDispatchCycle();

    expect(result.notificationsSent).toBe(1);
    expect(pushSendMock).toHaveBeenCalledTimes(1);
  });

  it("receipt invalida instalaciones cuando el proveedor devuelve DeviceNotRegistered", async () => {
    queryResultMock.mockResolvedValue({
      rows: [
        {
          delivery_id: 10,
          installation_id: "inst-invalid",
          provider_ticket_id: "ticket-invalid",
          attempt_count: 1,
        },
      ],
    });

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("UPDATE notification_deliveries SET")) return [];
      if (sql.includes("UPDATE device_installations SET")) return [];
      return [];
    });

    pushFetchReceiptsMock.mockResolvedValue([
      {
        providerTicketId: "ticket-invalid",
        providerReceiptId: "ticket-invalid",
        status: "invalid",
        errorCode: "DeviceNotRegistered",
        errorMessage: "DeviceNotRegistered",
      },
    ]);

    const runReceiptCycle = createRunReceiptCycle({
      query: queryMock,
      queryResult: queryResultMock,
      pushProvider: createPushProviderMock(),
      now: () => fixedNow,
      sleep: async () => undefined,
    });

    const result = await runReceiptCycle();

    expect(result.receiptsProcessed).toBe(1);
    expect(result.notificationsInvalidated).toBe(1);
  });

  it("cleanup archiva datos operativos viejos", async () => {
    queryResultMock
      .mockResolvedValueOnce({ rows: [{ archived_count: 4 }], rowCount: 1, command: "", oid: 0, fields: [] })
      .mockResolvedValueOnce({ rows: [{ archived_count: 9 }], rowCount: 1, command: "", oid: 0, fields: [] });

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("ensure_licitaciones_monthly_partitions")) return [];
      return [];
    });

    const runCleanupCycle = createRunCleanupCycle({
      query: queryMock,
      queryResult: queryResultMock,
      pushProvider: createPushProviderMock(),
      now: () => fixedNow,
      sleep: async () => undefined,
    });

    const result = await runCleanupCycle();

    expect(result.archivedLicitaciones).toBe(4);
    expect(result.archivedDeliveries).toBe(9);
  });
});
