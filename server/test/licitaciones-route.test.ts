import { Buffer } from "node:buffer";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, queryOneMock, checkDatabaseReadyMock, getPoolStatsMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  queryOneMock: vi.fn(),
  checkDatabaseReadyMock: vi.fn(),
  getPoolStatsMock: vi.fn(),
}));

vi.mock("../src/db", () => ({
  query: queryMock,
  queryOne: queryOneMock,
  checkDatabaseReady: checkDatabaseReadyMock,
  getPoolStats: getPoolStatsMock,
}));

import { createApp } from "../src/app";

describe("GET /api/licitaciones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkDatabaseReadyMock.mockResolvedValue({
      ok: true,
      durationMs: 5,
      stats: {
        totalCount: 1,
        idleCount: 1,
        waitingCount: 0,
        maxConnections: 4,
      },
    });
    getPoolStatsMock.mockReturnValue({
      totalCount: 1,
      idleCount: 1,
      waitingCount: 0,
      maxConnections: 4,
    });
  });

  it("responde health desde createApp", async () => {
    const app = createApp();

    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
  });

  it("arma query cursor-based con ventana hot por defecto", async () => {
    queryMock.mockResolvedValue([
      {
        id: "2",
        codigo_externo: "222",
        nombre: "Licitación 2",
        organismo_nombre: "MOP",
        tipo: "L1",
        monto_estimado: "5000",
        monto_label: null,
        moneda: "CLP",
        fecha_publicacion: "2026-01-02T00:00:00.000Z",
        fecha_cierre: "2026-01-03T00:00:00.000Z",
        estado: "Publicada",
        url: "https://example.com/2",
        region: "RM",
        categoria: "General",
        created_at: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "1",
        codigo_externo: "111",
        nombre: "Licitación 1",
        organismo_nombre: "MOP",
        tipo: "L1",
        monto_estimado: "4000",
        monto_label: null,
        moneda: "CLP",
        fecha_publicacion: "2026-01-01T00:00:00.000Z",
        fecha_cierre: "2026-01-02T00:00:00.000Z",
        estado: "Publicada",
        url: "https://example.com/1",
        region: "RM",
        categoria: "General",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const app = createApp();
    const response = await request(app).get("/api/licitaciones?limit=1");

    expect(response.status).toBe(200);
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][0]).toContain("WHERE created_at >= $1");
    expect(queryMock.mock.calls[0][0]).toContain("ORDER BY created_at DESC, id DESC");
    expect(queryMock.mock.calls[0][1]).toHaveLength(2);
    expect(queryMock.mock.calls[0][1][1]).toBe(2);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.pageInfo.hasMore).toBe(true);
    expect(response.body.pageInfo.nextCursor).toBeTruthy();
  });

  it("combina filtros y cursor manteniendo orden estable", async () => {
    queryMock.mockResolvedValue([]);
    const cursor = Buffer.from(
      JSON.stringify({
        createdAt: "2026-01-02T00:00:00.000Z",
        id: "2",
      }),
      "utf8"
    ).toString("base64url");

    const app = createApp();
    const response = await request(app).get(
      `/api/licitaciones?limit=10&cursor=${encodeURIComponent(cursor)}&rubro=45&tipo=L1`
    );

    expect(response.status).toBe(200);
    expect(queryMock.mock.calls[0][0]).toContain("rubro_code LIKE $2");
    expect(queryMock.mock.calls[0][0]).toContain("tipo = $3");
    expect(queryMock.mock.calls[0][0]).toContain("(created_at, id) < ($4::timestamptz, $5)");
    expect(queryMock.mock.calls[0][1].slice(1)).toEqual([
      "45%",
      "L1",
      "2026-01-02T00:00:00.000Z",
      "2",
      11,
    ]);
  });

  it("agrega filtros por región y monto excluyendo montos nulos", async () => {
    queryMock.mockResolvedValue([]);

    const app = createApp();
    const response = await request(app).get(
      "/api/licitaciones?limit=20&region=RM&montoMin=1000000&montoMax=5000000&windowDays=30"
    );

    expect(response.status).toBe(200);
    expect(queryMock.mock.calls[0][0]).toContain("region = $2");
    expect(queryMock.mock.calls[0][0]).toContain(
      "monto_estimado IS NOT NULL AND monto_estimado >= $3"
    );
    expect(queryMock.mock.calls[0][0]).toContain(
      "monto_estimado IS NOT NULL AND monto_estimado <= $4"
    );
    expect(queryMock.mock.calls[0][1][4]).toBe(21);
    expect(response.body.pageInfo.windowDays).toBe(30);
  });

  it("rechaza cursores inválidos", async () => {
    const app = createApp();
    const response = await request(app).get("/api/licitaciones?cursor=nope");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Cursor inválido" });
  });

  it("lista regiones disponibles para la UX del feed dentro de la ventana hot", async () => {
    queryMock.mockResolvedValue([{ region: "RM" }, { region: "Valparaíso" }]);

    const app = createApp();
    const response = await request(app).get("/api/licitaciones/regions?windowDays=45");

    expect(response.status).toBe(200);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("SELECT DISTINCT region"),
      [expect.any(String)]
    );
    expect(response.body).toEqual({
      data: [{ name: "RM" }, { name: "Valparaíso" }],
    });
  });

  it("entrega detalle por id o código externo", async () => {
    queryOneMock.mockResolvedValue({
      id: "1",
      codigo_externo: "111",
      nombre: "Licitación 1",
      organismo_nombre: "MOP",
      tipo: "L1",
      monto_estimado: "5000",
      monto_label: null,
      moneda: "CLP",
      fecha_publicacion: "2026-01-01T00:00:00.000Z",
      fecha_cierre: "2026-01-02T00:00:00.000Z",
      estado: "Publicada",
      url: "https://example.com",
      region: "RM",
      categoria: "General",
      created_at: "2026-01-01T00:00:00.000Z",
    });

    const app = createApp();
    const response = await request(app).get("/api/licitaciones/111");

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe("1");
  });
});
