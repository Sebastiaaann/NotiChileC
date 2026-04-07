import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/theme/colors";
import {
  bootstrapPushInstallation,
  getCachedPushInstallationSnapshot,
  type PushInstallationSnapshot,
} from "../../src/services/push-installation";
import { isDemoApp } from "../../src/services/app-env";

function getEnvironmentLabel(
  environment: PushInstallationSnapshot["environment"],
  demoApp: boolean
) {
  if (demoApp) {
    return "Demo controlada";
  }

  switch (environment) {
    case "expo-go":
      return "Expo Go";
    case "development":
      return "Development build";
    case "production":
      return "Producción";
  }
}

function getStatusCopy(snapshot: PushInstallationSnapshot, demoApp: boolean) {
  if (demoApp) {
    switch (snapshot.registrationStatus) {
      case "registered":
        return "Este iPhone está listo para recibir alertas durante la demo.";
      case "permission_denied":
        return "Los permisos de notificación están bloqueados. Habilitalos antes de mostrar la demo.";
      case "unsupported_environment":
        return "Para la demo usá la build instalada en tu iPhone, no Expo Go.";
      case "unsupported_device":
        return "La demo con notificaciones necesita un dispositivo físico.";
      case "not_registered":
        return "Todavía no registramos este dispositivo para las alertas demo.";
    }
  }

  switch (snapshot.registrationStatus) {
    case "registered":
      return "Este dispositivo ya quedó sincronizado con el backend y puede recibir alertas.";
    case "permission_denied":
      return "El sistema operativo bloqueó permisos de notificación. Rehabilitalos en Ajustes.";
    case "unsupported_environment":
      return "Expo Go no permite registrar un token nuevo. Si este dispositivo ya estaba registrado antes, las notificaciones pueden seguir llegando.";
    case "unsupported_device":
      return "Las notificaciones push requieren un dispositivo físico.";
    case "not_registered":
      return "Todavía no se registró este dispositivo para push.";
  }
}

function getStatusTone(snapshot: PushInstallationSnapshot) {
  if (snapshot.registrationStatus === "registered") return "success";
  if (snapshot.registrationStatus === "permission_denied") return "warning";
  return "info";
}

export default function SettingsScreen() {
  const demoApp = isDemoApp();
  const [pushSnapshot, setPushSnapshot] =
    useState<PushInstallationSnapshot | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(true);
  const [registering, setRegistering] = useState(false);

  const environmentLabel = useMemo(() => {
    if (!pushSnapshot) return "—";
    return getEnvironmentLabel(pushSnapshot.environment, demoApp);
  }, [pushSnapshot, demoApp]);

  useEffect(() => {
    let cancelled = false;

    async function loadSnapshot() {
      try {
        const snapshot = await getCachedPushInstallationSnapshot();
        if (!cancelled) {
          setPushSnapshot(snapshot);
        }
      } catch (error) {
        console.warn("[push] Error cargando estado de push:", error);
      } finally {
        if (!cancelled) {
          setLoadingSnapshot(false);
        }
      }
    }

    void loadSnapshot();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleReRegister() {
    if (registering || !pushSnapshot) return;

    if (pushSnapshot.capability !== "supported") {
      Alert.alert(
        "Push no disponible",
        getStatusCopy(pushSnapshot, demoApp)
      );
      return;
    }

    setRegistering(true);
    try {
      const snapshot = await bootstrapPushInstallation();
      setPushSnapshot(snapshot);

      if (snapshot.registrationStatus === "registered") {
        Alert.alert("Listo", "Push sincronizado correctamente.");
      } else {
        Alert.alert("Estado de push", getStatusCopy(snapshot, demoApp));
      }
    } catch (error) {
      Alert.alert(
        "Error",
        error instanceof Error ? error.message : "Error desconocido"
      );
    } finally {
      setRegistering(false);
    }
  }

  const bannerTone = pushSnapshot ? getStatusTone(pushSnapshot) : "info";

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      {/* Device Card */}
      <View style={styles.card}>
        <View style={styles.deviceRow}>
          <View style={styles.deviceIcon}>
            <Ionicons name="phone-portrait" size={24} color={colors.primary} />
          </View>
          <View style={styles.deviceInfo}>
            <Text style={styles.deviceTitle}>Dispositivo</Text>
            <Text style={styles.deviceSub}>
              {Platform.OS === "ios" ? "iPhone" : "Android"} • {environmentLabel}
            </Text>
          </View>
        </View>
      </View>

      {/* Push Section */}
      <Text style={styles.sectionLabel}>NOTIFICACIONES PUSH</Text>

      <View style={styles.card}>
        {loadingSnapshot && !pushSnapshot ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Verificando estado de push...</Text>
          </View>
        ) : pushSnapshot ? (
          <>
            <View style={styles.statusHeader}>
              <View style={styles.toggleInfo}>
                <Text style={styles.toggleTitle}>Alertas de licitaciones</Text>
                <Text style={styles.toggleSub}>
                  {getStatusCopy(pushSnapshot, demoApp)}
                </Text>
              </View>
              {pushSnapshot.capability === "supported" ? (
                <TouchableOpacity
                  onPress={handleReRegister}
                  disabled={registering}
                  style={[
                    styles.actionButton,
                    registering && styles.actionButtonDisabled,
                  ]}
                >
                  <Text style={styles.actionButtonText}>
                    {pushSnapshot.registrationStatus === "registered"
                      ? "Re-sincronizar"
                      : "Registrar push"}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <View
              style={[
                styles.statusBanner,
                bannerTone === "success" && styles.statusBannerSuccess,
                bannerTone === "warning" && styles.statusBannerWarning,
                bannerTone === "info" && styles.statusBannerInfo,
              ]}
            >
              <Ionicons
                name={
                  bannerTone === "success"
                    ? "checkmark-circle"
                    : bannerTone === "warning"
                      ? "warning"
                      : "information-circle"
                }
                size={16}
                color={
                  bannerTone === "success"
                    ? colors.success
                    : bannerTone === "warning"
                      ? colors.warning
                      : colors.primary
                }
              />
              <Text
                style={[
                  styles.statusText,
                  bannerTone === "success" && styles.statusTextSuccess,
                  bannerTone === "warning" && styles.statusTextWarning,
                  bannerTone === "info" && styles.statusTextInfo,
                ]}
                >
                  <Text style={styles.statusBold}>
                    {pushSnapshot.registrationStatus === "registered"
                      ? demoApp
                        ? "Dispositivo listo para la demo."
                        : "Token sincronizado."
                      : pushSnapshot.registrationStatus === "permission_denied"
                        ? "Permisos denegados."
                        : pushSnapshot.registrationStatus === "unsupported_environment"
                          ? demoApp
                            ? "Usá la build de demo en tu iPhone."
                            : "Expo Go no soporta registro."
                          : pushSnapshot.registrationStatus === "unsupported_device"
                            ? "Dispositivo no compatible."
                            : demoApp
                              ? "Pendiente de preparar el iPhone para la demo."
                              : "Pendiente de registro."}
                  </Text>
                  {"\n"}
                  {pushSnapshot.backendSyncStatus === "failed"
                    ? demoApp
                      ? "No pudimos sincronizar este estado con el backend demo todavía."
                      : `La sincronización con el backend falló${pushSnapshot.backendSyncError ? `: ${pushSnapshot.backendSyncError}` : "."}`
                    : pushSnapshot.backendSyncStatus === "synced"
                      ? demoApp
                        ? "El backend demo ya reconoce este dispositivo."
                        : "El backend quedó sincronizado con este estado."
                      : demoApp
                        ? "Este estado todavía no se sincronizó con el backend demo."
                        : "Este estado solo vive localmente hasta que se sincronice."}
                </Text>
              </View>

            {__DEV__ && pushSnapshot.token ? (
              <View style={styles.tokenCard}>
                <Text style={styles.tokenLabel}>Push Token</Text>
                <Text style={styles.tokenValue} selectable>
                  {pushSnapshot.token}
                </Text>
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.loadingState}>
            <Text style={styles.loadingText}>
              No se pudo leer el estado de push.
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 24,
  },

  // Cards
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },

  // Device
  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    padding: 20,
  },
  deviceIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primaryBg,
    alignItems: "center",
    justifyContent: "center",
  },
  deviceInfo: {
    flex: 1,
  },
  deviceTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  deviceSub: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // Section label
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textSecondary,
    letterSpacing: 0.5,
    marginBottom: 12,
    marginLeft: 4,
  },

  loadingState: {
    padding: 20,
    gap: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    fontSize: 13,
    color: colors.textSecondary,
  },

  statusHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  toggleInfo: {
    flex: 1,
  },
  toggleTitle: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.textPrimary,
  },
  toggleSub: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
    lineHeight: 18,
  },
  actionButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.primaryBg,
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
  actionButtonText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "600",
  },

  statusBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 16,
  },
  statusBannerSuccess: {
    backgroundColor: "rgba(5, 150, 105, 0.05)",
  },
  statusBannerWarning: {
    backgroundColor: "rgba(245, 158, 11, 0.08)",
  },
  statusBannerInfo: {
    backgroundColor: "rgba(59, 130, 246, 0.06)",
  },
  statusText: {
    fontSize: 12,
    lineHeight: 18,
    flex: 1,
  },
  statusTextSuccess: {
    color: colors.success,
  },
  statusTextWarning: {
    color: colors.warning,
  },
  statusTextInfo: {
    color: colors.primary,
  },
  statusBold: {
    fontWeight: "700",
  },

  tokenCard: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  tokenLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textSecondary,
    marginBottom: 8,
  },
  tokenValue: {
    fontSize: 11,
    color: colors.textPrimary,
    fontFamily: "monospace",
  },
});
