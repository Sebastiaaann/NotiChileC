import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, queryOneMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  queryOneMock: vi.fn(),
}));

vi.mock("../src/db", () => ({
  query: queryMock,
  queryOne: queryOneMock,
}));

import { createApp } from "../src/app";

function makeInstallationRow(overrides: Record<string, unknown> = {}) {
  return {
    installation_id: "inst-1",
    push_token: "ExponentPushToken[abc]",
    platform: "ios",
    environment: "development",
    app_version: "1.0.0",
    push_capable: true,
    permission_status: "granted",
    active: true,
    invalidated_at: null,
    invalid_reason: null,
    last_seen_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makePreferenceRow(overrides: Record<string, unknown> = {}) {
  return {
    installation_id: "inst-1",
    enabled: true,
    rubro: null,
    tipo: null,
    region: null,
    monto_min: null,
    monto_max: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("Installations API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockResolvedValue([]);
  });

  it("sincroniza una instalación nueva, crea preferencias por defecto y refleja el token legacy", async () => {
    queryOneMock
      .mockResolvedValueOnce(null) // existingById
      .mockResolvedValueOnce(null) // existingByToken
      .mockResolvedValueOnce(makePreferenceRow());
    queryMock.mockResolvedValueOnce([
      makeInstallationRow({ installation_id: "inst-1" }),
    ]);

    const app = createApp();
    const response = await request(app)
      .put("/api/installations/inst-1/sync")
      .send({
        pushToken: "ExponentPushToken[abc]",
        platform: "ios",
        environment: "development",
        appVersion: "1.0.0",
        pushCapable: true,
        permissionStatus: "granted",
      });

    expect(response.status).toBe(200);
    expect(response.body.data.installationId).toBe("inst-1");
    expect(response.body.preferences.enabled).toBe(true);
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO device_installations"))).toBe(true);
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO device_tokens"))).toBe(true);
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO notification_preferences"))).toBe(true);
  });

  it("expone preferencias por defecto cuando la instalación existe pero aún no hay preferencias guardadas", async () => {
    queryOneMock
      .mockResolvedValueOnce(makeInstallationRow({ installation_id: "inst-2" }))
      .mockResolvedValueOnce(makePreferenceRow({ installation_id: "inst-2" }));

    const app = createApp();
    const response = await request(app).get(
      "/api/installations/inst-2/preferences"
    );

    expect(response.status).toBe(200);
    expect(response.body.data.enabled).toBe(true);
    expect(response.body.data.rubro).toBeNull();
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO notification_preferences"))).toBe(true);
  });

  it("actualiza preferencias server-side para una instalación existente", async () => {
    queryOneMock
      .mockResolvedValueOnce(makeInstallationRow({ installation_id: "inst-3" }))
      .mockResolvedValueOnce(
        makePreferenceRow({
          installation_id: "inst-3",
          enabled: false,
          rubro: "45000000",
          tipo: "LE",
          region: "RM",
          monto_min: 1000000,
          monto_max: 5000000,
        })
      );

    const app = createApp();
    const response = await request(app)
      .put("/api/installations/inst-3/preferences")
      .send({
        enabled: false,
        rubro: "45000000",
        tipo: "LE",
        region: "RM",
        montoMin: 1000000,
        montoMax: 5000000,
      });

    expect(response.status).toBe(200);
    expect(response.body.data.enabled).toBe(false);
    expect(response.body.data.montoMin).toBe(1000000);
    expect(response.body.data.montoMax).toBe(5000000);
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes("ON CONFLICT (installation_id) DO UPDATE SET"))).toBe(true);
  });

  it("mantiene el alias legacy de devices/register con instalación determinística", async () => {
    queryOneMock
      .mockResolvedValueOnce(null) // registerLegacyDeviceFromToken -> existing installation by token
      .mockResolvedValueOnce(null) // syncInternal -> existingById
      .mockResolvedValueOnce(null) // syncInternal -> existingByToken
      .mockResolvedValueOnce(makePreferenceRow({ installation_id: "legacy:token" }));
    queryMock.mockResolvedValueOnce([
      makeInstallationRow({ installation_id: "legacy:token" }),
    ]);

    const app = createApp();
    const response = await request(app)
      .post("/api/devices/register")
      .send({
        expoPushToken: "ExponentPushToken[legacy-token]",
        platform: "ios",
      });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    const installationInsert = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO device_installations")
    );
    expect(installationInsert).toBeDefined();
    expect(String(installationInsert?.[1]?.[0])).toMatch(/^legacy:/);
  });
});
