export interface FeedFilters {
  rubro: string | null;
  tipo: string | null;
  region: string | null;
  montoMin: number | null;
  montoMax: number | null;
  montoPresetId: string | null;
}

export interface MontoPreset {
  id: string;
  label: string;
  min: number | null;
  max: number | null;
}

export interface FeedNotificationPreferencesPayload {
  enabled: boolean;
  rubro: string | null;
  tipo: string | null;
  region: string | null;
  montoMin: number | null;
  montoMax: number | null;
}

export const FEED_FILTERS_STORAGE_KEY = "notichilec.feed-filters.v1";

export const DEFAULT_FEED_FILTERS: FeedFilters = {
  rubro: null,
  tipo: null,
  region: null,
  montoMin: null,
  montoMax: null,
  montoPresetId: null,
};

export const MONTO_PRESETS: MontoPreset[] = [
  { id: "hasta-10m", label: "Hasta $10M", min: null, max: 10_000_000 },
  {
    id: "10m-a-100m",
    label: "$10M-$100M",
    min: 10_000_000,
    max: 100_000_000,
  },
  { id: "mas-100m", label: "Más de $100M", min: 100_000_000, max: null },
];

export function isFeedFilters(value: unknown): value is FeedFilters {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;

  return (
    ("rubro" in candidate) &&
    ("tipo" in candidate) &&
    ("region" in candidate) &&
    ("montoMin" in candidate) &&
    ("montoMax" in candidate) &&
    ("montoPresetId" in candidate)
  );
}

export function sanitizeFeedFilters(value: unknown): FeedFilters {
  if (!isFeedFilters(value)) {
    return { ...DEFAULT_FEED_FILTERS };
  }

  return {
    rubro: typeof value.rubro === "string" ? value.rubro : null,
    tipo: typeof value.tipo === "string" ? value.tipo : null,
    region: typeof value.region === "string" ? value.region : null,
    montoMin: typeof value.montoMin === "number" ? value.montoMin : null,
    montoMax: typeof value.montoMax === "number" ? value.montoMax : null,
    montoPresetId:
      typeof value.montoPresetId === "string" ? value.montoPresetId : null,
  };
}

export function hasActiveFeedFilters(filters: FeedFilters): boolean {
  return Boolean(
    filters.rubro ||
      filters.tipo ||
      filters.region ||
      filters.montoMin !== null ||
      filters.montoMax !== null
  );
}

export function toFeedNotificationPreferences(
  filters: FeedFilters
): FeedNotificationPreferencesPayload {
  return {
    enabled: hasActiveFeedFilters(filters),
    rubro: filters.rubro,
    tipo: filters.tipo,
    region: filters.region,
    montoMin: filters.montoMin,
    montoMax: filters.montoMax,
  };
}

export const mapFeedFiltersToPreferences = toFeedNotificationPreferences;
