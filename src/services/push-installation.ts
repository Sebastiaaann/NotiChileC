import Constants from "expo-constants";
import { Platform } from "react-native";
import {
  registerDevice,
  syncInstallation,
  updateInstallationPreferences,
  ApiError,
} from "./api";
import { localStorage } from "./local-storage";
import {
  mapFeedFiltersToPreferences,
  type FeedFilters,
} from "./feed-filters";
import {
  inspectPushRuntime,
  registerForPushNotifications,
} from "./push";
import type {
  InstallationPreferencesPayload,
  InstallationSyncPayload,
  PushRegistrationResult,
  PushRuntimeSnapshot,
} from "./installation-types";

const INSTALLATION_ID_STORAGE_KEY = "notichilec.installation-id.v1";
const PUSH_INSTALLATION_SNAPSHOT_KEY = "notichilec.push-installation.v1";

export interface PushInstallationSnapshot extends PushRegistrationResult {
  installationId: string;
  platform: "ios" | "android";
  appVersion: string;
  backendSyncStatus: "synced" | "failed" | "skipped";
  backendSyncMode: "new" | "legacy" | "failed" | "skipped";
  backendSyncError: string | null;
  syncedAt: string | null;
}

let installationIdCache: string | null = null;

function generateInstallationId(): string {
  const cryptoRandomUUID =
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID.bind(globalThis.crypto)
      : null;

  if (cryptoRandomUUID) {
    return cryptoRandomUUID();
  }

  return `notichilec-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function getAppVersion(): string {
  const configVersion = Constants.expoConfig?.version;
  if (typeof configVersion === "string" && configVersion.length > 0) {
    return configVersion;
  }

  return "1.0.0";
}

async function readStoredInstallationId(): Promise<string | null> {
  try {
    return await localStorage.getItem(INSTALLATION_ID_STORAGE_KEY);
  } catch (error) {
    if (__DEV__) {
      console.warn("[push-installation] No se pudo leer installationId:", error);
    }
    return null;
  }
}

export async function getOrCreateInstallationId(): Promise<string> {
  if (installationIdCache) {
    return installationIdCache;
  }

  const stored = await readStoredInstallationId();
  if (stored) {
    installationIdCache = stored;
    return stored;
  }

  const generated = generateInstallationId();
  installationIdCache = generated;

  try {
    await localStorage.setItem(INSTALLATION_ID_STORAGE_KEY, generated);
  } catch (error) {
    if (__DEV__) {
      console.warn(
        "[push-installation] No se pudo persistir installationId, usando memoria:",
        error
      );
    }
  }

  return generated;
}

async function savePushInstallationSnapshot(
  snapshot: PushInstallationSnapshot
): Promise<void> {
  try {
    await localStorage.setItem(
      PUSH_INSTALLATION_SNAPSHOT_KEY,
      JSON.stringify(snapshot)
    );
  } catch (error) {
    if (__DEV__) {
      console.warn(
        "[push-installation] No se pudo guardar snapshot de push:",
        error
      );
    }
  }
}

async function readPushInstallationSnapshot(): Promise<PushInstallationSnapshot | null> {
  try {
    const raw = await localStorage.getItem(PUSH_INSTALLATION_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PushInstallationSnapshot;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (error) {
    if (__DEV__) {
      console.warn(
        "[push-installation] No se pudo leer snapshot de push, usando estado local:",
        error
      );
    }
    return null;
  }
}

async function syncInstallationWithFallback(
  installationId: string,
  payload: InstallationSyncPayload
): Promise<{ mode: "new" | "legacy" | "failed"; error: string | null }> {
  try {
    await syncInstallation(installationId, payload);
    return { mode: "new", error: null };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404 && payload.pushToken) {
      try {
        await registerDevice(payload.pushToken);
        return { mode: "legacy", error: null };
      } catch (legacyError) {
        const message =
          legacyError instanceof Error
            ? legacyError.message
            : "Error registrando token legacy";
        return { mode: "failed", error: message };
      }
    }

    const message = error instanceof Error ? error.message : "Error sincronizando instalación";
    return { mode: "failed", error: message };
  }
}

function runtimeToSnapshot(
  installationId: string,
  runtime: PushRuntimeSnapshot,
  pushToken: string | null,
  backendSyncStatus: "synced" | "failed" | "skipped",
  backendSyncMode: "new" | "legacy" | "failed" | "skipped",
  backendSyncError: string | null
): PushInstallationSnapshot {
  return {
    installationId,
    platform: Platform.OS === "ios" ? "ios" : "android",
    appVersion: getAppVersion(),
    ...runtime,
    ok: pushToken !== null && runtime.capability === "supported",
    token: pushToken,
    backendSyncStatus,
    backendSyncMode,
    backendSyncError,
    syncedAt: backendSyncStatus === "synced" ? new Date().toISOString() : null,
  };
}

export async function getCachedPushInstallationSnapshot(): Promise<PushInstallationSnapshot> {
  const stored = await readPushInstallationSnapshot();
  if (stored) {
    return stored;
  }

  const installationId = await getOrCreateInstallationId();
  const runtime = await inspectPushRuntime();
  return runtimeToSnapshot(
    installationId,
    runtime,
    null,
    "skipped",
    "skipped",
    null
  );
}

export async function bootstrapPushInstallation(): Promise<PushInstallationSnapshot> {
  const installationId = await getOrCreateInstallationId();
  const runtime = await inspectPushRuntime();

  const registration =
    runtime.capability === "supported"
      ? await registerForPushNotifications()
      : {
          ok: false,
          token: null,
          environment: runtime.environment,
          capability: runtime.capability,
          permissionStatus: runtime.permissionStatus,
          registrationStatus: runtime.registrationStatus,
          reason: runtime.reason,
        };
  const pushToken = registration.ok ? registration.token : null;

  const syncPayload: InstallationSyncPayload = {
    pushToken,
    platform: Platform.OS === "ios" ? "ios" : "android",
    environment: registration.environment,
    appVersion: getAppVersion(),
    pushCapable: registration.capability === "supported",
    permissionStatus: registration.permissionStatus,
  };

  const syncResult = await syncInstallationWithFallback(
    installationId,
    syncPayload
  );

  if (__DEV__) {
    if (syncResult.mode === "legacy") {
      console.info("[push-installation] Sincronización resuelta por fallback legacy.");
    } else if (syncResult.mode === "failed") {
      console.warn(
        "[push-installation] No se pudo sincronizar la instalación con el backend:",
        syncResult.error
      );
    }
  }

  const snapshot = runtimeToSnapshot(
    installationId,
    {
      ...registration,
      environment: registration.environment,
      capability: registration.capability,
      permissionStatus: registration.permissionStatus,
      registrationStatus: registration.registrationStatus,
      reason: registration.reason,
    },
    pushToken,
    syncResult.mode === "failed" ? "failed" : "synced",
    syncResult.mode,
    syncResult.error
  );

  await savePushInstallationSnapshot(snapshot);
  return snapshot;
}

export async function syncFeedFiltersPreferences(
  filters: FeedFilters
): Promise<void> {
  try {
    const installationId = await getOrCreateInstallationId();
    const payload: InstallationPreferencesPayload =
      mapFeedFiltersToPreferences(filters);

    await updateInstallationPreferences(installationId, payload);
  } catch (error) {
    if (__DEV__) {
      console.warn("[feed] No se pudieron sincronizar las preferencias:", error);
    }
  }
}
