import { useEffect, useRef } from "react";
import { Stack, useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { useFonts } from "expo-font";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import {
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from "@expo-google-fonts/plus-jakarta-sans";
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_700Bold,
} from "@expo-google-fonts/jetbrains-mono";
import { LibreBaskerville_400Regular_Italic } from "@expo-google-fonts/libre-baskerville";
import { startExpoGoAlerts } from "../src/services/expo-go-alerts";
import { setupNotificationHandler } from "../src/services/push";
import { bootstrapPushInstallation } from "../src/services/push-installation";
import { isDemoApp } from "../src/services/app-env";

// Configurar handler ANTES de que se monte el componente
setupNotificationHandler();

export default function RootLayout() {
  const demoApp = isDemoApp();
  const router = useRouter();
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_700Bold,
    LibreBaskerville_400Regular_Italic,
  });
  const notificationResponseListener =
    useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    startExpoGoAlerts();

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

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
  );
}
