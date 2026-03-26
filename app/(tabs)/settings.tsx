import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/theme/colors";
import { registerForPushNotifications } from "../../src/services/push";
import { registerDevice } from "../../src/services/api";

export default function SettingsScreen() {
  const [token, setToken] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    checkPushStatus();
  }, []);

  async function checkPushStatus() {
    const result = await registerForPushNotifications();
    if (result.ok) {
      setToken(result.token);
      setPushEnabled(true);
    } else {
      setToken(null);
      setPushEnabled(false);
    }
  }

  async function handleReRegister() {
    setRegistering(true);
    try {
      const result = await registerForPushNotifications();
      if (result.ok) {
        await registerDevice(result.token);
        setToken(result.token);
        setPushEnabled(true);
        Alert.alert("Listo", "Token push re-registrado correctamente");
      } else {
        Alert.alert("Error", result.reason);
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
              {Platform.OS === "ios" ? "iPhone" : "Android"} • Expo Go
            </Text>
          </View>
        </View>
      </View>

      {/* Push Section */}
      <Text style={styles.sectionLabel}>
        NOTIFICACIONES PUSH (FCM)
      </Text>

      <View style={styles.card}>
        {/* Toggle row */}
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleTitle}>Nuevas Licitaciones</Text>
            <Text style={styles.toggleSub}>Recibe alertas en &lt; 30 seg</Text>
          </View>
          <TouchableOpacity
            onPress={handleReRegister}
            disabled={registering}
            style={[
              styles.toggle,
              pushEnabled ? styles.toggleOn : styles.toggleOff,
            ]}
          >
            <View
              style={[
                styles.toggleThumb,
                pushEnabled ? styles.toggleThumbOn : styles.toggleThumbOff,
              ]}
            />
          </TouchableOpacity>
        </View>

        {/* Status message */}
        {pushEnabled && (
          <View style={styles.statusBanner}>
            <Ionicons
              name="checkmark-circle"
              size={16}
              color={colors.success}
            />
            <Text style={styles.statusText}>
              <Text style={styles.statusBold}>Token FCM registrado en DB.</Text>
              {"\n"}
              El Worker detectará nuevas licitaciones mediante polling (cada 5 min)
              y enviará un push a este dispositivo.
            </Text>
          </View>
        )}
      </View>

      {/* Token (collapsible) */}
      {token && (
        <View style={styles.tokenCard}>
          <Text style={styles.tokenLabel}>Push Token</Text>
          <Text style={styles.tokenValue} selectable>
            {token}
          </Text>
        </View>
      )}
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

  // Toggle
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
    marginTop: 2,
  },
  toggle: {
    width: 48,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    padding: 2,
  },
  toggleOn: {
    backgroundColor: colors.success,
  },
  toggleOff: {
    backgroundColor: "#D1D5DB",
  },
  toggleThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  toggleThumbOn: {
    alignSelf: "flex-end",
  },
  toggleThumbOff: {
    alignSelf: "flex-start",
  },

  // Status banner
  statusBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 16,
    backgroundColor: "rgba(5, 150, 105, 0.05)",
  },
  statusText: {
    fontSize: 12,
    color: colors.success,
    lineHeight: 18,
    flex: 1,
  },
  statusBold: {
    fontWeight: "700",
  },

  // Token
  tokenCard: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 12,
    padding: 12,
    marginBottom: 24,
  },
  tokenLabel: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 4,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tokenValue: {
    fontSize: 11,
    color: colors.textSecondary,
    fontFamily: "monospace",
    lineHeight: 16,
  },
});
