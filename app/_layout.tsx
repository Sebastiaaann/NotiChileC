import { useEffect, useRef, useState } from "react";
import { Stack, useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import {
  setupNotificationHandler,
  registerForPushNotifications,
} from "../src/services/push";
import { registerTokenWithRetry } from "../src/services/api";

// Configurar handler ANTES de que se monte el componente
setupNotificationHandler();

export default function RootLayout() {
  const router = useRouter();
  const [pushToken, setPushToken] = useState<string | null>(null);
  const notificationResponseListener =
    useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    // 1. Registrar para push notifications
    registerForPushNotifications().then(async (result) => {
      if (result.ok) {
        console.log("[push] Token obtenido:", result.token);
        setPushToken(result.token);

        // 2. Enviar token al backend
        await registerTokenWithRetry(result.token);
      } else {
        console.warn("[push] No se pudo registrar:", result.reason);
      }
    });

    // 3. Escuchar cuando el usuario toca una notificación
    notificationResponseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data;

        if (data?.licitacionId) {
          // Navegar al detalle de la licitación
          router.push(`/licitacion/${data.licitacionId as string}` as never);
        }
      });

    return () => {
      if (notificationResponseListener.current) {
        notificationResponseListener.current.remove();
      }
    };
  }, []);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
  );
}
