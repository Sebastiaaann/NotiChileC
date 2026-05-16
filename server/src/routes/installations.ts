import { Router, type Request, type Response } from "express";
import { db } from "../db";
import { deviceInstallations, deviceTokens, notificationPreferences } from "../db/schema";
import { eq, sql } from "drizzle-orm";
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

async function syncInstallationInternal(
  installationId: string,
  payload: InstallationSyncBody
): Promise<SyncResult> {
  return db.transaction(async (tx) => {
    const existingById = await tx.select()
      .from(deviceInstallations)
      .where(eq(deviceInstallations.installation_id, installationId))
      .limit(1)
      .then(rows => (rows[0] as unknown as DeviceInstallationRow) ?? null);

    const existingByToken =
      payload.pushToken === null
        ? null
        : await tx.select()
            .from(deviceInstallations)
            .where(eq(deviceInstallations.push_token, payload.pushToken))
            .limit(1)
            .then(rows => (rows[0] as unknown as DeviceInstallationRow) ?? null);

    if (existingById && existingByToken && existingByToken.installation_id !== installationId) {
      const error = new Error(
        "pushToken ya está asociado a otra instalación"
      );
      (error as Error & { statusCode?: number }).statusCode = 409;
      throw error;
    }

    const state = computeInstallationState(payload);
    const now = sql`NOW()`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const setData: Record<string, any> = {
      push_token: payload.pushToken,
      platform: payload.platform,
      environment: payload.environment,
      app_version: payload.appVersion,
      push_capable: payload.pushCapable,
      permission_status: payload.permissionStatus,
      active: state.active,
      invalidated_at: state.invalidatedAt ?? null,
      invalid_reason: state.invalidReason,
      last_seen_at: now,
      updated_at: now,
    };

    let installationRow: DeviceInstallationRow | null = null;

    if (existingById) {
      const rows = await tx.update(deviceInstallations)
        .set(setData)
        .where(eq(deviceInstallations.installation_id, installationId))
        .returning();
      installationRow = (rows[0] as unknown as DeviceInstallationRow) ?? null;
    } else if (existingByToken) {
      const rows = await tx.update(deviceInstallations)
        .set({
          installation_id: installationId,
          ...setData,
        })
        .where(eq(deviceInstallations.installation_id, existingByToken.installation_id))
        .returning();
      installationRow = (rows[0] as unknown as DeviceInstallationRow) ?? null;

      await tx.update(deviceTokens)
        .set({ installation_id: installationId })
        .where(eq(deviceTokens.installation_id, existingByToken.installation_id));
    } else {
      const rows = await tx.insert(deviceInstallations)
        .values({
          installation_id: installationId,
          ...setData,
        })
        .returning();
      installationRow = (rows[0] as unknown as DeviceInstallationRow) ?? null;
    }

    if (!installationRow) {
      throw new Error("No se pudo guardar la instalación");
    }

    // Mirror to device_tokens
    if (payload.pushToken === null || !payload.pushCapable || payload.permissionStatus !== "granted" || payload.environment === "expo-go") {
      await tx.update(deviceTokens)
        .set({
          active: false,
          installation_id: sql`COALESCE(installation_id, ${installationId})`,
          last_seen_at: now,
        })
        .where(eq(deviceTokens.installation_id, installationId));
    } else {
      await tx.update(deviceTokens)
        .set({
          active: false,
          last_seen_at: now,
        })
        .where(
          sql`${deviceTokens.installation_id} = ${installationId} AND ${deviceTokens.expo_push_token} <> ${payload.pushToken}`
        );

      await tx.insert(deviceTokens)
        .values({
          expo_push_token: payload.pushToken,
          installation_id: installationId,
          platform: payload.platform,
          active: true,
          last_seen_at: now,
        })
        .onConflictDoUpdate({
          target: deviceTokens.expo_push_token,
          set: {
            installation_id: installationId,
            platform: payload.platform,
            active: true,
            last_seen_at: now,
          },
        });
    }

    // Ensure preferences row exists
    await tx.insert(notificationPreferences)
      .values({
        installation_id: installationId,
        enabled: DEFAULT_PREFERENCES.enabled,
        rubro: DEFAULT_PREFERENCES.rubro,
        tipo: DEFAULT_PREFERENCES.tipo,
        region: DEFAULT_PREFERENCES.region,
        monto_min: DEFAULT_PREFERENCES.montoMin?.toString() ?? null,
        monto_max: DEFAULT_PREFERENCES.montoMax?.toString() ?? null,
        updated_at: now,
      })
      .onConflictDoNothing();

    const prefRow = await tx.select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.installation_id, installationId))
      .limit(1)
      .then(rows => rows[0] as unknown as NotificationPreferencesRow | undefined);

    if (!prefRow) {
      throw new Error("No se pudo leer preferencias de la instalación");
    }

    return {
      installation: mapInstallation(installationRow),
      preferences: mapPreferences(prefRow),
    };
  });
}

export async function getPreferencesForInstallation(
  installationId: string
): Promise<PreferencesResponse | null> {
  const installation = await db.select()
    .from(deviceInstallations)
    .where(eq(deviceInstallations.installation_id, installationId))
    .limit(1)
    .then(rows => rows[0] as unknown as DeviceInstallationRow | undefined);
  if (!installation) return null;

  await db.insert(notificationPreferences)
    .values({
      installation_id: installationId,
      enabled: DEFAULT_PREFERENCES.enabled,
      rubro: DEFAULT_PREFERENCES.rubro,
      tipo: DEFAULT_PREFERENCES.tipo,
      region: DEFAULT_PREFERENCES.region,
      monto_min: DEFAULT_PREFERENCES.montoMin?.toString() ?? null,
      monto_max: DEFAULT_PREFERENCES.montoMax?.toString() ?? null,
      updated_at: sql`NOW()`,
    })
    .onConflictDoNothing();

  const prefRow = await db.select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.installation_id, installationId))
    .limit(1)
    .then(rows => rows[0] as unknown as NotificationPreferencesRow | undefined);

  if (!prefRow) {
    throw new Error("No se pudo leer preferencias de la instalación");
  }
  return mapPreferences(prefRow);
}

export async function updatePreferencesForInstallation(
  installationId: string,
  payload: NotificationPreferencesBody
): Promise<PreferencesResponse | null> {
  const installation = await db.select()
    .from(deviceInstallations)
    .where(eq(deviceInstallations.installation_id, installationId))
    .limit(1)
    .then(rows => rows[0] as unknown as DeviceInstallationRow | undefined);
  if (!installation) return null;

  await db.insert(notificationPreferences)
    .values({
      installation_id: installationId,
      enabled: payload.enabled,
      rubro: payload.rubro,
      tipo: payload.tipo,
      region: payload.region,
      monto_min: payload.montoMin?.toString() ?? null,
      monto_max: payload.montoMax?.toString() ?? null,
      updated_at: sql`NOW()`,
    })
    .onConflictDoUpdate({
      target: notificationPreferences.installation_id,
      set: {
        enabled: payload.enabled,
        rubro: payload.rubro,
        tipo: payload.tipo,
        region: payload.region,
        monto_min: payload.montoMin?.toString() ?? null,
        monto_max: payload.montoMax?.toString() ?? null,
        updated_at: sql`NOW()`,
      },
    });

  const row = await db.select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.installation_id, installationId))
    .limit(1)
    .then(rows => rows[0] as unknown as NotificationPreferencesRow | undefined);

  return row ? mapPreferences(row) : null;
}

export async function registerLegacyDeviceFromToken(
  expoPushToken: string,
  platform?: string
): Promise<void> {
  const existing = await db.select()
    .from(deviceInstallations)
    .where(eq(deviceInstallations.push_token, expoPushToken))
    .limit(1)
    .then(rows => rows[0] as unknown as DeviceInstallationRow | undefined);

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
