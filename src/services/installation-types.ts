import type { FeedFilters } from "./feed-filters";

export type InstallationEnvironment =
  | "expo-go"
  | "development"
  | "production";

export type InstallationPermissionStatus = "granted" | "denied" | "undetermined";

export type PushCapability = "supported" | "unsupported_environment" | "unsupported_device";

export type PushRegistrationStatus =
  | "registered"
  | "not_registered"
  | "permission_denied"
  | "unsupported_environment"
  | "unsupported_device";

export interface PushRuntimeSnapshot {
  environment: InstallationEnvironment;
  capability: PushCapability;
  permissionStatus: InstallationPermissionStatus;
  registrationStatus: PushRegistrationStatus;
  reason: string | null;
}

export interface PushRegistrationResult extends PushRuntimeSnapshot {
  ok: boolean;
  token: string | null;
}

export interface InstallationSyncPayload {
  pushToken: string | null;
  platform: "ios" | "android";
  environment: InstallationEnvironment;
  appVersion: string;
  pushCapable: boolean;
  permissionStatus: InstallationPermissionStatus;
}

export interface InstallationPreferencesPayload {
  enabled: boolean;
  rubro: string | null;
  tipo: string | null;
  region: string | null;
  montoMin: number | null;
  montoMax: number | null;
}

export function mapFeedFiltersToPreferences(
  filters: FeedFilters
): InstallationPreferencesPayload {
  return {
    enabled: true,
    rubro: filters.rubro,
    tipo: filters.tipo,
    region: filters.region,
    montoMin: filters.montoMin,
    montoMax: filters.montoMax,
  };
}
