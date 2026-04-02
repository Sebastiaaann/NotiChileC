import { Router, type Request, type Response } from "express";
import { query, queryOne } from "../db";
import { apiLogger } from "../observability/logger";
import { captureException } from "../observability/sentry";

export type PushEnvironment = "expo-go" | "development" | "production";
export type PushPermissionStatus = "granted" | "denied" | "undetermined";
export type LegacyPlatform = "ios" | "android" | "unknown";

export interface InstallationSyncBody {
  pushToken: string | null;
  platform: "ios" | "android";
  environment: PushEnvironment;
  appVersion: string;
  pushCapable: boolean;
  permissionStatus: PushPermissionStatus;
}

export interface NotificationPreferencesBody {
  enabled: boolean;
  rubro: string | null;
  tipo: string | null;
  region: string | null;
  montoMin: number | null;
  montoMax: number | null;
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
  invalidated_at: string | null;
  invalid_reason: string | null;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

interface NotificationPreferencesRow extends Record<string, unknown> {
  installation_id: string;
  enabled: boolean;
  rubro: string | null;
  tipo: string | null;
  region: string | null;
  monto_min: string | number | null;
  monto_max: string | number | null;
  updated_at: string;
}

export interface InstallationResponse {
  installationId: string;
  pushToken: string | null;
  platform: string;
  environment: PushEnvironment | string;
  appVersion: string;
  pushCapable: boolean;
  permissionStatus: PushPermissionStatus | string;
  active: boolean;
  invalidatedAt: string | null;
  invalidReason: string | null;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PreferencesResponse {
  enabled: boolean;
  rubro: string | null;
  tipo: string | null;
  region: string | null;
  montoMin: number | null;
  montoMax: number | null;
  updatedAt: string;
}

interface SyncResult {
  installation: InstallationResponse;
  preferences: PreferencesResponse;
}

const DEFAULT_PREFERENCES: NotificationPreferencesBody = {
  enabled: true,
  rubro: null,
  tipo: null,
  region: null,
  montoMin: null,
  montoMax: null,
};

const LEGACY_APP_VERSION = "legacy";
const LEGACY_ENVIRONMENT: PushEnvironment = "development";

const router = Router();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isPushEnvironment(value: unknown): value is PushEnvironment {
  return value === "expo-go" || value === "development" || value === "production";
}

function isPushPermissionStatus(value: unknown): value is PushPermissionStatus {
  return value === "granted" || value === "denied" || value === "undetermined";
}

function isPlatform(value: unknown): value is "ios" | "android" {
  return value === "ios" || value === "android";
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function parseSyncBody(body: unknown): InstallationSyncBody | null {
  if (!isRecord(body)) return null;

  const pushToken =
    body.pushToken === null
      ? null
      : asNonEmptyString(body.pushToken);
  const appVersion = asNonEmptyString(body.appVersion);

  if (body.pushToken !== null && pushToken === null) return null;
  if (!isPlatform(body.platform)) return null;
  if (!isPushEnvironment(body.environment)) return null;
  if (!appVersion) return null;
  if (typeof body.pushCapable !== "boolean") return null;
  if (!isPushPermissionStatus(body.permissionStatus)) return null;

  return {
    pushToken,
    platform: body.platform,
    environment: body.environment,
    appVersion,
    pushCapable: body.pushCapable,
    permissionStatus: body.permissionStatus,
  };
}

function parsePreferencesBody(body: unknown): NotificationPreferencesBody | null {
  if (!isRecord(body)) return null;
  if (typeof body.enabled !== "boolean") return null;
  if (!isNullableFiniteNumber(body.montoMin)) return null;
  if (!isNullableFiniteNumber(body.montoMax)) return null;

  const rubro = body.rubro === null ? null : asNonEmptyString(body.rubro);
  if (body.rubro !== null && rubro === null) return null;

  const tipo = body.tipo === null ? null : asNonEmptyString(body.tipo);
  if (body.tipo !== null && tipo === null) return null;

  const region = body.region === null ? null : asNonEmptyString(body.region);
  if (body.region !== null && region === null) return null;

  return {
    enabled: body.enabled,
    rubro,
    tipo,
    region,
    montoMin: body.montoMin,
    montoMax: body.montoMax,
  };
}

function computeInstallationState(payload: InstallationSyncBody) {
  const pushToken = payload.pushToken;
  const active =
    payload.pushCapable &&
    payload.permissionStatus === "granted" &&
    pushToken !== null &&
    payload.environment !== "expo-go";

  let invalidReason: string | null = null;
  if (!active) {
    if (payload.environment === "expo-go") {
      invalidReason = "expo-go";
    } else if (!payload.pushCapable) {
      invalidReason = "push-capable-false";
    } else if (payload.permissionStatus !== "granted") {
      invalidReason = `permission-${payload.permissionStatus}`;
    } else if (pushToken === null) {
      invalidReason = "missing-token";
    } else {
      invalidReason = "not-active";
    }
  }

  return {
    active,
    invalidatedAt: active ? null : new Date().toISOString(),
    invalidReason,
  };
}

function mapInstallation(row: DeviceInstallationRow): InstallationResponse {
  return {
    installationId: row.installation_id,
    pushToken: row.push_token,
    platform: row.platform,
    environment: row.environment,
    appVersion: row.app_version,
    pushCapable: row.push_capable,
    permissionStatus: row.permission_status,
    active: row.active,
    invalidatedAt: row.invalidated_at,
    invalidReason: row.invalid_reason,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toNullableNumber(value: string | number | null): number | null {
  if (value === null) return null;
  return typeof value === "number" ? value : Number(value);
}

function mapPreferences(row: NotificationPreferencesRow): PreferencesResponse {
  return {
    enabled: row.enabled,
    rubro: row.rubro,
    tipo: row.tipo,
    region: row.region,
    montoMin: toNullableNumber(row.monto_min),
    montoMax: toNullableNumber(row.monto_max),
    updatedAt: row.updated_at,
  };
}

async function ensureInstallationExists(
  installationId: string
): Promise<DeviceInstallationRow | null> {
  return queryOne<DeviceInstallationRow>(
    `SELECT installation_id, push_token, platform, environment, app_version,
            push_capable, permission_status, active, invalidated_at, invalid_reason,
            last_seen_at, created_at, updated_at
     FROM device_installations
     WHERE installation_id = $1`,
    [installationId]
  );
}

async function ensurePreferencesRow(installationId: string): Promise<PreferencesResponse> {
  await query(
    `INSERT INTO notification_preferences (
       installation_id, enabled, rubro, tipo, region, monto_min, monto_max, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (installation_id) DO NOTHING`,
    [
      installationId,
      DEFAULT_PREFERENCES.enabled,
      DEFAULT_PREFERENCES.rubro,
      DEFAULT_PREFERENCES.tipo,
      DEFAULT_PREFERENCES.region,
      DEFAULT_PREFERENCES.montoMin,
      DEFAULT_PREFERENCES.montoMax,
    ]
  );

  const row = await queryOne<NotificationPreferencesRow>(
    `SELECT installation_id, enabled, rubro, tipo, region, monto_min, monto_max, updated_at
     FROM notification_preferences
     WHERE installation_id = $1`,
    [installationId]
  );

  if (!row) {
    throw new Error("No se pudo leer preferencias de la instalación");
  }

  return mapPreferences(row);
}

async function updateDeviceTokenMirror(
  installationId: string,
  payload: InstallationSyncBody,
  previousInstallationId?: string
): Promise<void> {
  if (previousInstallationId && previousInstallationId !== installationId) {
    await query(
      `UPDATE device_tokens
       SET installation_id = $2
       WHERE installation_id = $1`,
      [previousInstallationId, installationId]
    );
  }

  if (payload.pushToken === null || !payload.pushCapable || payload.permissionStatus !== "granted" || payload.environment === "expo-go") {
    await query(
      `UPDATE device_tokens
       SET active = FALSE,
           installation_id = COALESCE(installation_id, $2),
           last_seen_at = NOW()
       WHERE installation_id = $1`,
      [installationId, installationId]
    );
    return;
  }

  await query(
    `UPDATE device_tokens
     SET active = FALSE,
         last_seen_at = NOW()
     WHERE installation_id = $1
       AND expo_push_token <> $2`,
    [installationId, payload.pushToken]
  );

  await query(
    `INSERT INTO device_tokens (
       expo_push_token, installation_id, platform, active, last_seen_at
     ) VALUES ($1, $2, $3, TRUE, NOW())
     ON CONFLICT (expo_push_token) DO UPDATE SET
       installation_id = EXCLUDED.installation_id,
       platform = EXCLUDED.platform,
       active = TRUE,
       last_seen_at = NOW()`,
    [payload.pushToken, installationId, payload.platform]
  );
}

async function syncInstallationInternal(
  installationId: string,
  payload: InstallationSyncBody
): Promise<SyncResult> {
  const existingById = await ensureInstallationExists(installationId);
  const existingByToken =
    payload.pushToken === null
      ? null
      : await queryOne<DeviceInstallationRow>(
          `SELECT installation_id, push_token, platform, environment, app_version,
                  push_capable, permission_status, active, invalidated_at, invalid_reason,
                  last_seen_at, created_at, updated_at
           FROM device_installations
           WHERE push_token = $1`,
          [payload.pushToken]
        );

  if (existingById && existingByToken && existingByToken.installation_id !== installationId) {
    const error = new Error(
      "pushToken ya está asociado a otra instalación"
    );
    (error as Error & { statusCode?: number }).statusCode = 409;
    throw error;
  }

  const state = computeInstallationState(payload);
  let installationRow: DeviceInstallationRow | null = null;

  if (existingById) {
    const rows = await query<DeviceInstallationRow>(
      `UPDATE device_installations SET
         push_token = $2,
         platform = $3,
         environment = $4,
         app_version = $5,
         push_capable = $6,
         permission_status = $7,
         active = $8,
         invalidated_at = $9,
         invalid_reason = $10,
         last_seen_at = NOW(),
         updated_at = NOW()
       WHERE installation_id = $1
       RETURNING installation_id, push_token, platform, environment, app_version,
                 push_capable, permission_status, active, invalidated_at, invalid_reason,
                 last_seen_at, created_at, updated_at`,
      [
        installationId,
        payload.pushToken,
        payload.platform,
        payload.environment,
        payload.appVersion,
        payload.pushCapable,
        payload.permissionStatus,
        state.active,
        state.invalidatedAt,
        state.invalidReason,
      ]
    );

    installationRow = rows[0] ?? null;
  } else if (existingByToken) {
    const previousInstallationId = existingByToken.installation_id;
    const rows = await query<DeviceInstallationRow>(
      `UPDATE device_installations SET
         installation_id = $1,
         platform = $3,
         environment = $4,
         app_version = $5,
         push_capable = $6,
         permission_status = $7,
         active = $8,
         invalidated_at = $9,
         invalid_reason = $10,
         last_seen_at = NOW(),
         updated_at = NOW()
       WHERE installation_id = $2
       RETURNING installation_id, push_token, platform, environment, app_version,
                 push_capable, permission_status, active, invalidated_at, invalid_reason,
                 last_seen_at, created_at, updated_at`,
      [
        installationId,
        existingByToken.installation_id,
        payload.platform,
        payload.environment,
        payload.appVersion,
        payload.pushCapable,
        payload.permissionStatus,
        state.active,
        state.invalidatedAt,
        state.invalidReason,
      ]
    );

    installationRow = rows[0] ?? null;

    await query(
      `UPDATE device_tokens
       SET installation_id = $2
       WHERE installation_id = $1`,
      [previousInstallationId, installationId]
    );
  } else {
    const rows = await query<DeviceInstallationRow>(
      `INSERT INTO device_installations (
         installation_id, push_token, platform, environment, app_version,
         push_capable, permission_status, active, invalidated_at, invalid_reason,
         last_seen_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW(), NOW())
       RETURNING installation_id, push_token, platform, environment, app_version,
                 push_capable, permission_status, active, invalidated_at, invalid_reason,
                 last_seen_at, created_at, updated_at`,
      [
        installationId,
        payload.pushToken,
        payload.platform,
        payload.environment,
        payload.appVersion,
        payload.pushCapable,
        payload.permissionStatus,
        state.active,
        state.invalidatedAt,
        state.invalidReason,
      ]
    );

    installationRow = rows[0] ?? null;
  }

  if (!installationRow) {
    throw new Error("No se pudo guardar la instalación");
  }

  await updateDeviceTokenMirror(installationId, payload);
  const preferences = await ensurePreferencesRow(installationId);

  return {
    installation: mapInstallation(installationRow),
    preferences,
  };
}

export async function getPreferencesForInstallation(
  installationId: string
): Promise<PreferencesResponse | null> {
  const installation = await ensureInstallationExists(installationId);
  if (!installation) return null;
  return ensurePreferencesRow(installationId);
}

export async function updatePreferencesForInstallation(
  installationId: string,
  payload: NotificationPreferencesBody
): Promise<PreferencesResponse | null> {
  const installation = await ensureInstallationExists(installationId);
  if (!installation) return null;

  await query(
    `INSERT INTO notification_preferences (
       installation_id, enabled, rubro, tipo, region, monto_min, monto_max, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (installation_id) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       rubro = EXCLUDED.rubro,
       tipo = EXCLUDED.tipo,
       region = EXCLUDED.region,
       monto_min = EXCLUDED.monto_min,
       monto_max = EXCLUDED.monto_max,
       updated_at = NOW()`,
    [
      installationId,
      payload.enabled,
      payload.rubro,
      payload.tipo,
      payload.region,
      payload.montoMin,
      payload.montoMax,
    ]
  );

  const row = await queryOne<NotificationPreferencesRow>(
    `SELECT installation_id, enabled, rubro, tipo, region, monto_min, monto_max, updated_at
     FROM notification_preferences
     WHERE installation_id = $1`,
    [installationId]
  );

  return row ? mapPreferences(row) : null;
}

export async function registerLegacyDeviceFromToken(
  expoPushToken: string,
  platform?: string
): Promise<void> {
  const existing = await queryOne<DeviceInstallationRow>(
    `SELECT installation_id, push_token, platform, environment, app_version,
            push_capable, permission_status, active, invalidated_at, invalid_reason,
            last_seen_at, created_at, updated_at
     FROM device_installations
     WHERE push_token = $1`,
    [expoPushToken]
  );

  const installationId =
    existing?.installation_id ?? buildLegacyInstallationId(expoPushToken);

  await syncInstallationInternal(installationId, {
    pushToken: expoPushToken,
    platform: isKnownPlatform(platform) ? platform : "ios",
    environment: LEGACY_ENVIRONMENT,
    appVersion: LEGACY_APP_VERSION,
    pushCapable: true,
    permissionStatus: "granted",
  });
}

export function buildLegacyInstallationId(expoPushToken: string): string {
  return `legacy:${Buffer.from(expoPushToken).toString("base64url")}`;
}

function isKnownPlatform(value: unknown): value is "ios" | "android" {
  return value === "ios" || value === "android";
}

router.put(
  "/:installationId/sync",
  async (req: Request, res: Response) => {
    try {
      const installationId = asNonEmptyString(req.params.installationId);
      if (!installationId) {
        res.status(400).json({ error: "installationId es requerido" });
        return;
      }

      const payload = parseSyncBody(req.body);
      if (!payload) {
        res.status(400).json({
          error:
            "Body inválido. Se espera pushToken, platform, environment, appVersion, pushCapable y permissionStatus",
        });
        return;
      }

      const result = await syncInstallationInternal(installationId, payload);
      res.json({ data: result.installation, preferences: result.preferences });
    } catch (error) {
      const statusCode =
        typeof error === "object" && error && "statusCode" in error
          ? Number((error as { statusCode?: number }).statusCode)
          : 500;
      captureException(error, {
        route: "/api/installations/:installationId/sync",
        method: "PUT",
      });
      apiLogger.error("installation_sync_failed", {
        route: "/api/installations/:installationId/sync",
        error_code: "installation_sync_failed",
        error: error instanceof Error ? error : new Error(String(error)),
      });
      res.status(statusCode === 409 ? 409 : 500).json({
        error:
          statusCode === 409
            ? "pushToken ya está asociado a otra instalación"
            : "Error interno",
      });
    }
  }
);

router.get(
  "/:installationId/preferences",
  async (req: Request, res: Response) => {
    try {
      const installationId = asNonEmptyString(req.params.installationId);
      if (!installationId) {
        res.status(400).json({ error: "installationId es requerido" });
        return;
      }

      const preferences = await getPreferencesForInstallation(installationId);
      if (!preferences) {
        res.status(404).json({ error: "Instalación no encontrada" });
        return;
      }

      res.json({ data: preferences });
    } catch (error) {
      captureException(error, {
        route: "/api/installations/:installationId/preferences",
        method: "GET",
      });
      apiLogger.error("installation_preferences_read_failed", {
        route: "/api/installations/:installationId/preferences",
        error_code: "installation_preferences_read_failed",
        error: error instanceof Error ? error : new Error(String(error)),
      });
      res.status(500).json({ error: "Error interno" });
    }
  }
);

router.put(
  "/:installationId/preferences",
  async (req: Request, res: Response) => {
    try {
      const installationId = asNonEmptyString(req.params.installationId);
      if (!installationId) {
        res.status(400).json({ error: "installationId es requerido" });
        return;
      }

      const payload = parsePreferencesBody(req.body);
      if (!payload) {
        res.status(400).json({
          error:
            "Body inválido. Se espera enabled, rubro, tipo, region, montoMin y montoMax",
        });
        return;
      }

      if (
        payload.montoMin !== null &&
        payload.montoMax !== null &&
        payload.montoMin > payload.montoMax
      ) {
        res.status(400).json({
          error: "montoMin no puede ser mayor que montoMax",
        });
        return;
      }

      const preferences = await updatePreferencesForInstallation(
        installationId,
        payload
      );

      if (!preferences) {
        res.status(404).json({ error: "Instalación no encontrada" });
        return;
      }

      res.json({ data: preferences });
    } catch (error) {
      captureException(error, {
        route: "/api/installations/:installationId/preferences",
        method: "PUT",
      });
      apiLogger.error("installation_preferences_write_failed", {
        route: "/api/installations/:installationId/preferences",
        error_code: "installation_preferences_write_failed",
        error: error instanceof Error ? error : new Error(String(error)),
      });
      res.status(500).json({ error: "Error interno" });
    }
  }
);

export default router;
