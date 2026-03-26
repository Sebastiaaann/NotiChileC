import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, tipoColors } from "../../src/theme/colors";
import { fetchLicitaciones, type Licitacion } from "../../src/services/api";

// ── Helpers ─────────────────────────────────────────

function timeAgo(fecha: string | null): string {
  if (!fecha) return "";
  try {
    const diff = Date.now() - new Date(fecha).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Ahora";
    if (mins < 60) return `Hace ${mins} min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `Hace ${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `Hace ${days}d`;
    return `Hace ${Math.floor(days / 30)} mes`;
  } catch {
    return "";
  }
}

function isCerrada(item: Licitacion): boolean {
  if (item.estado !== "Publicada") return true;
  if (!item.fechaCierre) return false;
  return new Date(item.fechaCierre).getTime() < Date.now();
}

// ── Component ───────────────────────────────────────

export default function LicitacionesFeed() {
  const router = useRouter();
  const [licitaciones, setLicitaciones] = useState<Licitacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const loadLicitaciones = useCallback(
    async (pageNum: number = 1, isRefresh: boolean = false) => {
      try {
        if (isRefresh) setRefreshing(true);
        else if (pageNum === 1) setLoading(true);

        const response = await fetchLicitaciones(pageNum);

        if (pageNum === 1) {
          setLicitaciones(response.data);
        } else {
          setLicitaciones((prev) => [...prev, ...response.data]);
        }

        setHasMore(pageNum < response.pagination.totalPages);
        setPage(pageNum);
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Error cargando licitaciones"
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    loadLicitaciones(1);
  }, [loadLicitaciones]);

  const onRefresh = useCallback(() => {
    loadLicitaciones(1, true);
  }, [loadLicitaciones]);

  const onLoadMore = useCallback(() => {
    if (hasMore && !loading) {
      loadLicitaciones(page + 1);
    }
  }, [hasMore, loading, page, loadLicitaciones]);

  // ── Card ────────────────────────────────────────

  const renderItem = ({ item }: { item: Licitacion }) => {
    const cerrada = isCerrada(item);
    const tipoColor = tipoColors[item.tipo ?? ""] ?? colors.textMuted;
    const ago = timeAgo(item.createdAt);

    return (
      <TouchableOpacity
        style={[styles.card, cerrada && styles.cardCerrada]}
        activeOpacity={0.7}
        onPress={() => router.push(`/licitacion/${item.id}`)}
      >
        {/* Top: código badge + time ago */}
        <View style={styles.cardTop}>
          <View style={styles.codeBadge}>
            <Text style={styles.codeBadgeText}>
              {item.codigoExterno || item.tipo || "—"}
            </Text>
          </View>
          {ago ? (
            <View style={styles.timeRow}>
              <Ionicons name="time-outline" size={12} color={colors.textMuted} />
              <Text style={styles.timeText}>{ago}</Text>
            </View>
          ) : null}
        </View>

        {/* Title */}
        <Text
          style={[styles.title, cerrada && styles.titleCerrada]}
          numberOfLines={2}
        >
          {item.nombre}
        </Text>

        {/* Entity */}
        {item.organismoNombre && (
          <View style={styles.entityRow}>
            <Ionicons
              name="business-outline"
              size={15}
              color={colors.textSecondary}
            />
            <Text style={styles.entityText} numberOfLines={1}>
              {item.organismoNombre}
            </Text>
          </View>
        )}

        {/* Footer: monto + chevron */}
        <View style={styles.cardFooter}>
          <View style={styles.footerLeft}>
            {item.montoLabel ? (
              <Text style={styles.monto}>{item.montoLabel}</Text>
            ) : (
              <Text style={styles.montoEmpty}>Sin monto</Text>
            )}
            {cerrada && (
              <View style={styles.cerradaBadge}>
                <Text style={styles.cerradaBadgeText}>Cerrada</Text>
              </View>
            )}
          </View>
          <Ionicons
            name="chevron-forward"
            size={20}
            color={colors.border}
          />
        </View>
      </TouchableOpacity>
    );
  };

  // ── States ──────────────────────────────────────

  if (loading && licitaciones.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Cargando licitaciones...</Text>
      </View>
    );
  }

  if (error && licitaciones.length === 0) {
    return (
      <View style={styles.center}>
        <Ionicons name="cloud-offline-outline" size={48} color={colors.error} />
        <Text style={styles.errorTitle}>Error de conexión</Text>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => loadLicitaciones(1)}
        >
          <Text style={styles.retryText}>Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={licitaciones}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        onEndReached={onLoadMore}
        onEndReachedThreshold={0.3}
        ListFooterComponent={
          hasMore ? (
            <ActivityIndicator
              style={styles.footer}
              color={colors.primary}
            />
          ) : licitaciones.length > 0 ? (
            <Text style={styles.endText}>No hay más licitaciones</Text>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons
              name="document-text-outline"
              size={48}
              color={colors.textMuted}
            />
            <Text style={styles.emptyText}>
              Aún no hay licitaciones. El worker está buscando...
            </Text>
          </View>
        }
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  list: {
    padding: 16,
    gap: 16,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    backgroundColor: colors.background,
  },

  // Card
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardCerrada: {
    opacity: 0.6,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  codeBadge: {
    backgroundColor: colors.primaryBg,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  codeBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.primary,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  timeText: {
    fontSize: 11,
    color: colors.textMuted,
  },

  // Title
  title: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textPrimary,
    lineHeight: 21,
    marginBottom: 6,
  },
  titleCerrada: {
    color: colors.textSecondary,
  },

  // Entity
  entityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 12,
  },
  entityText: {
    fontSize: 13,
    color: colors.textSecondary,
    flex: 1,
  },

  // Footer
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  footerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  monto: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  montoEmpty: {
    fontSize: 13,
    color: colors.textMuted,
  },
  cerradaBadge: {
    backgroundColor: colors.errorBg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  cerradaBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.error,
  },

  // States
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: colors.textSecondary,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textPrimary,
    marginTop: 12,
  },
  errorText: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: "center",
    marginTop: 4,
  },
  retryButton: {
    marginTop: 16,
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 12,
  },
  retryText: {
    color: colors.textOnPrimary,
    fontWeight: "600",
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: 12,
  },
  footer: {
    paddingVertical: 16,
  },
  endText: {
    textAlign: "center",
    color: colors.textMuted,
    fontSize: 13,
    paddingVertical: 16,
  },
});
