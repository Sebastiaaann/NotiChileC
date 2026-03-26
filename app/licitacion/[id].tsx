import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, tipoColors, tipoLabels } from "../../src/theme/colors";
import { fetchLicitacion, type Licitacion } from "../../src/services/api";

// ── Helpers ─────────────────────────────────────────

function timeAgo(fecha: string | null): string {
  if (!fecha) return "";
  try {
    const diff = Date.now() - new Date(fecha).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Hace un momento";
    if (mins < 60) return `Hace ${mins} min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `Hace ${hrs} horas`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `Hace ${days} días`;
    return "";
  } catch {
    return "";
  }
}

function formatFecha(fecha: string | null): string {
  if (!fecha) return "—";
  try {
    return new Date(fecha).toLocaleDateString("es-CL", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

// ── Component ───────────────────────────────────────

export default function LicitacionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [licitacion, setLicitacion] = useState<Licitacion | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    fetchLicitacion(id)
      .then((res) => {
        setLicitacion(res.data);
        setError(null);
      })
      .catch((err) => {
        setError(
          err instanceof Error ? err.message : "Error cargando detalle"
        );
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: "Cargando..." }} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </>
    );
  }

  if (error || !licitacion) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: "Error" }} />
        <View style={styles.center}>
          <Ionicons
            name="alert-circle-outline"
            size={48}
            color={colors.error}
          />
          <Text style={styles.errorText}>
            {error ?? "Licitación no encontrada"}
          </Text>
        </View>
      </>
    );
  }

  const cerrada = (() => {
    if (licitacion.estado !== "Publicada") return true;
    if (!licitacion.fechaCierre) return false;
    return new Date(licitacion.fechaCierre).getTime() < Date.now();
  })();

  const ago = timeAgo(licitacion.createdAt);

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Detalle Licitación",
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
        }}
      />
      <View style={styles.container}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
        >
          {/* Code badge */}
          <View style={styles.codeBadge}>
            <Text style={styles.codeBadgeText}>
              {licitacion.codigoExterno}
            </Text>
          </View>

          {/* Title */}
          <Text style={styles.title}>{licitacion.nombre}</Text>

          {/* Time ago */}
          {ago ? (
            <Text style={styles.ago}>{ago}</Text>
          ) : null}

          {/* Info rows with circular icons */}
          <View style={styles.infoSection}>
            {/* Comprador */}
            <View style={styles.infoRow}>
              <View style={[styles.iconCircle, { backgroundColor: colors.surfaceElevated }]}>
                <Ionicons name="business" size={20} color={colors.textSecondary} />
              </View>
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Comprador</Text>
                <Text style={styles.infoValue}>
                  {licitacion.organismoNombre ?? "—"}
                </Text>
              </View>
            </View>

            {/* Monto */}
            <View style={styles.infoRow}>
              <View style={[styles.iconCircle, { backgroundColor: colors.successBg }]}>
                <Ionicons name="cash" size={20} color={colors.success} />
              </View>
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Monto Estimado</Text>
                <Text style={styles.montoValue}>
                  {licitacion.montoLabel ?? "No especificado"}
                </Text>
              </View>
            </View>

            {/* Cierre */}
            <View style={styles.infoRow}>
              <View style={[styles.iconCircle, { backgroundColor: cerrada ? colors.errorBg : colors.warningBg }]}>
                <Ionicons
                  name={cerrada ? "lock-closed" : "time"}
                  size={20}
                  color={cerrada ? colors.error : colors.warning}
                />
              </View>
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>
                  {cerrada ? "Cerrada" : "Cierre de recepción"}
                </Text>
                <Text style={styles.infoValue}>
                  {formatFecha(licitacion.fechaCierre)}
                </Text>
              </View>
            </View>

            {/* Región */}
            {licitacion.region && (
              <View style={styles.infoRow}>
                <View style={[styles.iconCircle, { backgroundColor: colors.primaryBg }]}>
                  <Ionicons name="location" size={20} color={colors.primary} />
                </View>
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Región</Text>
                  <Text style={styles.infoValue}>{licitacion.region}</Text>
                </View>
              </View>
            )}
          </View>

          {/* Fechas section */}
          <View style={styles.datesCard}>
            <View style={styles.dateRow}>
              <Text style={styles.dateLabel}>Publicación</Text>
              <Text style={styles.dateValue}>
                {formatFecha(licitacion.fechaPublicacion)}
              </Text>
            </View>
            <View style={styles.dateDivider} />
            <View style={styles.dateRow}>
              <Text style={styles.dateLabel}>Cierre</Text>
              <Text style={[styles.dateValue, cerrada && { color: colors.error }]}>
                {formatFecha(licitacion.fechaCierre)}
              </Text>
            </View>
          </View>

          {/* Spacer for bottom button */}
          <View style={{ height: 100 }} />
        </ScrollView>

        {/* Sticky bottom button */}
        {licitacion.url && (
          <View style={styles.bottomBar}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => Linking.openURL(licitacion.url!)}
              activeOpacity={0.8}
            >
              <Text style={styles.actionButtonText}>
                Ver en Mercado Público
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </>
  );
}

// ── Styles ────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 24,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    backgroundColor: colors.background,
  },
  errorText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: "center",
    marginTop: 12,
  },

  // Code badge
  codeBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.primaryBg,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 16,
  },
  codeBadgeText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.primary,
  },

  // Title
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textPrimary,
    lineHeight: 32,
    marginBottom: 4,
  },
  ago: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 24,
  },

  // Info section
  infoSection: {
    gap: 24,
    marginBottom: 24,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 16,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.textPrimary,
  },
  montoValue: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.success,
  },

  // Dates card
  datesCard: {
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateRow: {
    paddingVertical: 10,
  },
  dateDivider: {
    height: 1,
    backgroundColor: colors.border,
  },
  dateLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  dateValue: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.textPrimary,
  },

  // Bottom bar
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 16,
    backgroundColor: "rgba(255,255,255,0.95)",
  },
  actionButton: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  actionButtonText: {
    color: colors.textOnPrimary,
    fontSize: 16,
    fontWeight: "600",
  },
});
