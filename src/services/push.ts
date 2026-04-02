import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";
import type {
  InstallationEnvironment,
  InstallationPermissionStatus,
  PushCapability,
  PushRegistrationResult,
  PushRegistrationStatus,
  PushRuntimeSnapshot,
} from "./installation-types";

export const EXPO_GO_PUSH_SKIP_REASON =
  "Expo Go no soporta registro de push notifications";

/**
 * Configura cómo se muestran las notificaciones cuando la app está en foreground.
 */
export function setupNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export function isRunningInExpoGo(): boolean {
  return (
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
    Constants.appOwnership === "expo"
  );
}

export function resolvePushEnvironment(): InstallationEnvironment {
  if (isRunningInExpoGo()) {
    return "expo-go";
  }

  return __DEV__ ? "development" : "production";
}

function resolveCapability(): PushCapability {
  if (isRunningInExpoGo()) {
    return "unsupported_environment";
  }

  if (!Device.isDevice) {
    return "unsupported_device";
  }

  return "supported";
}

function resolveRegistrationStatus(
  capability: PushCapability,
  permissionStatus: InstallationPermissionStatus
): PushRegistrationStatus {
  if (capability === "unsupported_environment") return "unsupported_environment";
  if (capability === "unsupported_device") return "unsupported_device";
  if (permissionStatus === "denied") return "permission_denied";
  return "not_registered";
}

async function readPermissionStatus(): Promise<InstallationPermissionStatus> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === "granted" || status === "denied") {
      return status;
    }
  } catch (error) {
    if (__DEV__) {
      console.warn("[push] No se pudo leer el estado de permisos:", error);
    }
  }

  return "undetermined";
}

export async function inspectPushRuntime(): Promise<PushRuntimeSnapshot> {
  const capability = resolveCapability();
  const permissionStatus = await readPermissionStatus();
  const registrationStatus = resolveRegistrationStatus(
    capability,
    permissionStatus
  );

  return {
    environment: resolvePushEnvironment(),
    capability,
    permissionStatus,
    registrationStatus,
    reason:
      capability === "unsupported_environment"
        ? EXPO_GO_PUSH_SKIP_REASON
        : capability === "unsupported_device"
          ? "Las notificaciones push solo funcionan en dispositivos físicos"
          : permissionStatus === "denied"
            ? "Permisos de notificación denegados"
            : null,
  };
}

/**
 * Solicita permisos y obtiene el Expo Push Token.
 * Solo funciona en dispositivos físicos (no emulador).
 */
export async function registerForPushNotifications(): Promise<PushRegistrationResult> {
  const runtime = await inspectPushRuntime();

  if (runtime.capability !== "supported") {
    if (__DEV__) {
      console.info(`[push] ${runtime.reason ?? EXPO_GO_PUSH_SKIP_REASON}`);
    }

    return {
      ok: false,
      token: null,
      ...runtime,
    };
  }

  let permissionStatus = runtime.permissionStatus;

  if (permissionStatus !== "granted") {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status === "granted" || status === "denied") {
        permissionStatus = status;
      } else {
        permissionStatus = "undetermined";
      }
    } catch (error) {
      if (__DEV__) {
        console.warn("[push] No se pudo solicitar permiso de notificaciones:", error);
      }
      permissionStatus = "undetermined";
    }
  }

  if (permissionStatus !== "granted") {
    return {
      ok: false,
      token: null,
      environment: runtime.environment,
      capability: runtime.capability,
      permissionStatus,
      registrationStatus:
        permissionStatus === "denied"
          ? "permission_denied"
          : "not_registered",
      reason:
        permissionStatus === "denied"
          ? "Permisos de notificación denegados"
          : "Permisos de notificación no concedidos",
    };
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("licitaciones", {
      name: "Licitaciones Nuevas",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#1E40AF",
      sound: "default",
    });
  }

  try {
    const projectId = getProjectId();
    const tokenResponse = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();

    if (!tokenResponse.data) {
      return {
        ok: false,
        token: null,
        environment: runtime.environment,
        capability: runtime.capability,
        permissionStatus,
        registrationStatus: "not_registered",
        reason: "No se pudo obtener el token push",
      };
    }

    return {
      ok: true,
      token: tokenResponse.data,
      environment: runtime.environment,
      capability: runtime.capability,
      permissionStatus,
      registrationStatus: "registered",
      reason: null,
    };
  } catch (error) {
    return {
      ok: false,
      token: null,
      environment: runtime.environment,
      capability: runtime.capability,
      permissionStatus,
      registrationStatus: "not_registered",
      reason:
        error instanceof Error
          ? error.message
          : "Error obteniendo token push",
    };
  }
}

/**
 * Obtiene el projectId de Expo (necesario para push tokens).
 */
function getProjectId(): string | undefined {
  const easProjectId = Constants.easConfig?.projectId;
  if (typeof easProjectId === "string" && easProjectId.length > 0) {
    return easProjectId;
  }

  const extraProjectId = (Constants.expoConfig?.extra as Record<string, unknown>)?.eas as
    | { projectId?: string }
    | undefined;
  if (typeof extraProjectId?.projectId === "string") {
    return extraProjectId.projectId;
  }

  return undefined;
}
