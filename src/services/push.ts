import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";

export type PushResult =
  | { ok: true; token: string }
  | { ok: false; reason: string };

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

/**
 * Solicita permisos y obtiene el Expo Push Token.
 * Solo funciona en dispositivos físicos (no emulador).
 */
export async function registerForPushNotifications(): Promise<PushResult> {
  // Verificar que es un dispositivo real
  if (!Device.isDevice) {
    return {
      ok: false,
      reason: "Las notificaciones push solo funcionan en dispositivos físicos",
    };
  }

  // Configurar canal de Android
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("licitaciones", {
      name: "Licitaciones Nuevas",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#1E40AF",
      sound: "default",
    });
  }

  // Verificar/solicitar permisos
  const { status: existingStatus } =
    await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    return {
      ok: false,
      reason: "Permisos de notificación denegados",
    };
  }

  // Obtener token
  try {
    const projectId = getProjectId();
    const tokenResponse = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();

    if (!tokenResponse.data) {
      return {
        ok: false,
        reason: "No se pudo obtener el token push",
      };
    }

    return { ok: true, token: tokenResponse.data };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error
          ? error.message
          : "Error obteniendo token push",
    };
  }
}
