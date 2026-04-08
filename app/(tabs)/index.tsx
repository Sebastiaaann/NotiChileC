import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, tipoLabels } from "../../src/theme/colors";
import {
  fetchLicitaciones,
  fetchRubros,
  fetchRegions,
  type Licitacion,
  type RegionOption,
  type Rubro,
} from "../../src/services/api";
import {
  DEFAULT_FEED_FILTERS,
  FEED_FILTERS_STORAGE_KEY,
  hasActiveFeedFilters,
  MONTO_PRESETS,
  sanitizeFeedFilters,
  type FeedFilters,
} from "../../src/services/feed-filters";
import {
  DEFAULT_FEED_SORT_MODE,
  FEED_SORT_LABELS,
  FEED_SORT_MODES,
  FEED_SORT_STORAGE_KEY,
  sanitizeFeedSortMode,
  type FeedSortMode,
} from "../../src/services/feed-sort";
import { isDemoApp } from "../../src/services/app-env";
import { subscribeToExpoGoAlertRefresh } from "../../src/services/expo-go-alerts";
import { feedFiltersStorage } from "../../src/services/feed-filters-storage";
import { syncFeedFiltersPreferences } from "../../src/services/push-installation";

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

const HOT_WINDOW_DAYS = 90;

function mergeUniqueLicitaciones(
  current: Licitacion[],
  incoming: Licitacion[]
): Licitacion[] {
  const seen = new Set(current.map((item) => item.id));
  const nextItems = incoming.filter((item) => !seen.has(item.id));
  return nextItems.length > 0 ? [...current, ...nextItems] : current;
}

// ── Component ───────────────────────────────────────

export default function LicitacionesFeed() {
  const router = useRouter();
  const demoApp = isDemoApp();
  const [licitaciones, setLicitaciones] = useState<Licitacion[]>([]);
  const [rubros, setRubros] = useState<Rubro[]>([]);
  const [regions, setRegions] = useState<RegionOption[]>([]);
  const [filters, setFilters] = useState<FeedFilters>(DEFAULT_FEED_FILTERS);
  const [sortMode, setSortMode] = useState<FeedSortMode>(DEFAULT_FEED_SORT_MODE);
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const activeFilters = useMemo(() => hasActiveFeedFilters(filters), [filters]);
  const requestSequenceRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function initializeFeed() {
      try {
        const [rubrosResponse, regionsResponse, storedFilters, storedSortMode] =
          await Promise.all([
            fetchRubros().catch((err) => {
              if (!demoApp) {
                console.error("[feed] Error cargando rubros:", err);
              }
              return { data: [] as Rubro[] };
            }),
            fetchRegions().catch((err) => {
              if (!demoApp) {
                console.error("[feed] Error cargando regiones:", err);
              }
              return { data: [] as RegionOption[] };
            }),
            feedFiltersStorage.getItem(FEED_FILTERS_STORAGE_KEY),
            feedFiltersStorage.getItem(FEED_SORT_STORAGE_KEY),
          ]);

        if (cancelled) return;

        setRubros(rubrosResponse.data);
        setRegions(regionsResponse.data);

        if (storedFilters) {
          const parsed = JSON.parse(storedFilters) as unknown;
          setFilters(sanitizeFeedFilters(parsed));
        }

        if (storedSortMode) {
          setSortMode(sanitizeFeedSortMode(storedSortMode));
        }
      } catch (err) {
        if (!demoApp) {
          console.error("[feed] Error inicializando filtros:", err);
        }
      } finally {
        if (!cancelled) {
          setHydrated(true);
        }
      }
    }

    void initializeFeed();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    void feedFiltersStorage.setItem(
      FEED_FILTERS_STORAGE_KEY,
      JSON.stringify(filters)
    ).catch((err) => console.error("[feed] Error persistiendo filtros:", err));
  }, [filters, hydrated]);

  useEffect(() => {
    if (!hydrated) return;

    void feedFiltersStorage.setItem(FEED_SORT_STORAGE_KEY, sortMode).catch((err) =>
      console.error("[feed] Error persistiendo orden:", err)
    );
  }, [hydrated, sortMode]);

  const loadLicitaciones = useCallback(
    async (
      options: {
        cursor?: string | null;
        append?: boolean;
        isRefresh?: boolean;
      } = {}
    ) => {
      if (!hydrated) return;

      const isAppending = Boolean(options.append && options.cursor);
      if (isAppending && loadingMore) {
        return;
      }

      const requestSequence = ++requestSequenceRef.current;

      try {
        if (options.isRefresh) setRefreshing(true);
        else if (isAppending) setLoadingMore(true);
        else setLoading(true);

        const response = await fetchLicitaciones({
          cursor: options.cursor ?? null,
          limit: 20,
          windowDays: HOT_WINDOW_DAYS,
          filters,
          sortMode,
        });

        if (requestSequence !== requestSequenceRef.current) {
          return;
        }

        if (isAppending) {
          setLicitaciones((prev) => mergeUniqueLicitaciones(prev, response.data));
        } else {
          setLicitaciones(response.data);
        }

        setHasMore(response.pageInfo.hasMore);
        setNextCursor(response.pageInfo.nextCursor);
        setError(null);
      } catch (err) {
        if (requestSequence !== requestSequenceRef.current) {
          return;
        }

        setError(
          err instanceof Error ? err.message : "Error cargando licitaciones"
        );
      } finally {
        if (isAppending) {
          setLoadingMore(false);
          return;
        }

        if (requestSequence === requestSequenceRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [filters, hydrated, loadingMore, sortMode]
  );

  useEffect(() => {
    if (!hydrated) return;
    loadLicitaciones();
  }, [loadLicitaciones, hydrated]);

  useEffect(() => {
    if (!hydrated) return;

    return subscribeToExpoGoAlertRefresh(() => {
      void loadLicitaciones({ cursor: null, append: false, isRefresh: false });
    });
  }, [hydrated, loadLicitaciones]);

  useEffect(() => {
    if (!hydrated) return;

    const timeoutId = setTimeout(() => {
      void syncFeedFiltersPreferences(filters);
    }, 250);

    return () => clearTimeout(timeoutId);
  }, [filters, hydrated]);

  const onRefresh = useCallback(() => {
    loadLicitaciones({ cursor: null, append: false, isRefresh: true });
  }, [loadLicitaciones]);

  const onLoadMore = useCallback(() => {
    if (hasMore && !loading && !loadingMore && nextCursor) {
      loadLicitaciones({ cursor: nextCursor, append: true });
    }
  }, [hasMore, loading, loadingMore, nextCursor, loadLicitaciones]);

  const updateFilters = useCallback(
    (updater: (current: FeedFilters) => FeedFilters) => {
      setFilters((current) => updater(current));
    },
    []
  );

  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_FEED_FILTERS);
  }, []);

  const updateSortMode = useCallback((nextSortMode: FeedSortMode) => {
    setSortMode(nextSortMode);
  }, []);

  // ── Card ────────────────────────────────────────

  const renderItem = ({ item }: { item: Licitacion }) => {
    const cerrada = isCerrada(item);
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
        <Text style={styles.loadingText}>
          {demoApp ? "Preparando la demo..." : "Cargando licitaciones..."}
        </Text>
      </View>
    );
  }

  if (error && licitaciones.length === 0) {
    return (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.error} />
          <Text style={styles.errorTitle}>
            {demoApp ? "No pudimos actualizar la demo" : "Error de conexión"}
          </Text>
          <Text style={styles.errorText}>
            {demoApp
              ? "Mostremos una versión segura y estable. Reintentá cuando quieras para refrescar los datos."
              : error}
          </Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() =>
            loadLicitaciones({ cursor: null, append: false, isRefresh: false })
          }
        >
          <Text style={styles.retryText}>Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const renderFilters = () => (
    <View style={styles.filtersContainer}>
      <View style={styles.filtersHeader}>
        <View>
          <Text style={styles.filtersTitle}>Filtros</Text>
          {activeFilters ? (
            <Text style={styles.filtersSubtitle}>Filtros activos</Text>
          ) : (
            <Text style={styles.filtersSubtitle}>
              Mostrando {FEED_SORT_LABELS[sortMode].toLowerCase()}
            </Text>
          )}
        </View>
        {activeFilters ? (
          <TouchableOpacity
            accessibilityRole="button"
            onPress={clearFilters}
            style={styles.clearButton}
          >
            <Text style={styles.clearButtonText}>Limpiar filtros</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.sortHeader}>
        <Text style={styles.sortLabel}>Ordenar por</Text>
        <Text style={styles.sortValue}>{FEED_SORT_LABELS[sortMode]}</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterScrollContent}
      >
        {FEED_SORT_MODES.map((mode) => (
          <TouchableOpacity
            key={mode}
            accessibilityRole="button"
            style={[styles.chip, sortMode === mode && styles.chipActive]}
            onPress={() => updateSortMode(mode)}
          >
            <Text
              style={[
                styles.chipText,
                sortMode === mode && styles.chipTextActive,
              ]}
            >
              {FEED_SORT_LABELS[mode]}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterScrollContent}
      >
        <TouchableOpacity
          style={[styles.chip, !filters.rubro && styles.chipActive]}
          onPress={() =>
            updateFilters((current) => ({ ...current, rubro: null }))
          }
        >
          <Text
            style={[styles.chipText, !filters.rubro && styles.chipTextActive]}
          >
            Todos los rubros
          </Text>
        </TouchableOpacity>
        {rubros.map((rubro) => (
          <TouchableOpacity
            key={rubro.code}
            style={[
              styles.chip,
              filters.rubro === rubro.code && styles.chipActive,
            ]}
            onPress={() =>
              updateFilters((current) => ({ ...current, rubro: rubro.code }))
            }
          >
            <Text
              style={[
                styles.chipText,
                filters.rubro === rubro.code && styles.chipTextActive,
              ]}
            >
              {rubro.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterScrollContent}
      >
        <TouchableOpacity
          style={[styles.chip, !filters.tipo && styles.chipActive]}
          onPress={() => updateFilters((current) => ({ ...current, tipo: null }))}
        >
          <Text
            style={[styles.chipText, !filters.tipo && styles.chipTextActive]}
          >
            Todos los tipos
          </Text>
        </TouchableOpacity>
        {Object.entries(tipoLabels).map(([tipoCode, label]) => (
          <TouchableOpacity
            key={tipoCode}
            style={[
              styles.chip,
              filters.tipo === tipoCode && styles.chipActive,
            ]}
            onPress={() =>
              updateFilters((current) => ({ ...current, tipo: tipoCode }))
            }
          >
            <Text
              style={[
                styles.chipText,
                filters.tipo === tipoCode && styles.chipTextActive,
              ]}
            >
              {label} ({tipoCode})
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterScrollContent}
      >
        <TouchableOpacity
          style={[styles.chip, !filters.region && styles.chipActive]}
          onPress={() =>
            updateFilters((current) => ({ ...current, region: null }))
          }
        >
          <Text
            style={[styles.chipText, !filters.region && styles.chipTextActive]}
          >
            Todas las regiones
          </Text>
        </TouchableOpacity>
        {regions.map((region) => (
          <TouchableOpacity
            key={region.name}
            style={[
              styles.chip,
              filters.region === region.name && styles.chipActive,
            ]}
            onPress={() =>
              updateFilters((current) => ({ ...current, region: region.name }))
            }
          >
            <Text
              style={[
                styles.chipText,
                filters.region === region.name && styles.chipTextActive,
              ]}
            >
              {region.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterScrollContent}
      >
        <TouchableOpacity
          style={[styles.chip, !filters.montoPresetId && styles.chipActive]}
          onPress={() =>
            updateFilters((current) => ({
              ...current,
              montoPresetId: null,
              montoMin: null,
              montoMax: null,
            }))
          }
        >
          <Text
            style={[
              styles.chipText,
              !filters.montoPresetId && styles.chipTextActive,
            ]}
          >
            Todos los montos
          </Text>
        </TouchableOpacity>
        {MONTO_PRESETS.map((preset) => (
          <TouchableOpacity
            key={preset.id}
            style={[
              styles.chip,
              filters.montoPresetId === preset.id && styles.chipActive,
            ]}
            onPress={() =>
              updateFilters((current) => ({
                ...current,
                montoPresetId: preset.id,
                montoMin: preset.min,
                montoMax: preset.max,
              }))
            }
          >
            <Text
              style={[
                styles.chipText,
                filters.montoPresetId === preset.id && styles.chipTextActive,
              ]}
            >
              {preset.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <View style={styles.container}>
      {renderFilters()}
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
          loadingMore ? (
            <ActivityIndicator
              style={styles.footer}
              color={colors.primary}
            />
          ) : licitaciones.length > 0 ? (
            <Text style={styles.endText}>
              {demoApp
                ? "Ya viste todas las licitaciones preparadas para la demo"
                : "No hay más licitaciones"}
            </Text>
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
              {activeFilters
                ? demoApp
                  ? "No encontramos coincidencias para esos filtros en esta demo."
                  : "No hay licitaciones para estos filtros."
                : demoApp
                  ? "Estamos preparando licitaciones representativas para mostrarte."
                  : "Aún no hay licitaciones. El worker está buscando..."}
            </Text>
            {activeFilters ? (
              <TouchableOpacity
                style={styles.retryButton}
                onPress={clearFilters}
              >
                <Text style={styles.retryText}>Limpiar filtros</Text>
              </TouchableOpacity>
            ) : null}
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
  filtersContainer: {
    backgroundColor: colors.surface,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterScroll: {
    marginBottom: 8,
  },
  filtersHeader: {
    paddingHorizontal: 16,
    marginBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  filtersTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  filtersSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
  },
  sortHeader: {
    paddingHorizontal: 16,
    marginBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sortLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  sortValue: {
    fontSize: 12,
    color: colors.textMuted,
  },
  clearButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: colors.primaryBg,
  },
  clearButtonText: {
    color: colors.primary,
    fontWeight: "600",
    fontSize: 12,
  },
  filterScrollContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.primaryBg,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: "500",
  },
  chipTextActive: {
    color: colors.primary,
    fontWeight: "600",
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
