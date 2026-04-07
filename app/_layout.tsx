import { useEffect, useRef } from "react";
import { Stack, useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { setupNotificationHandler } from "../src/services/push";
import { bootstrapPushInstallation } from "../src/services/push-installation";
import { isDemoApp } from "../src/services/app-env";

// Configurar handler ANTES de que se monte el componente
setupNotificationHandler();

export default function RootLayout() {
  const demoApp = isDemoApp();
  const router = useRouter();
  const notificationResponseListener =
    useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    void bootstrapPushInstallation().catch((error) => {
      if (!demoApp) {
        console.warn("[push] Error inicializando push:", error);
      }
    });

    // Escuchar cuando el usuario toca una notificación
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
  }, [demoApp, router]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
  );
}
