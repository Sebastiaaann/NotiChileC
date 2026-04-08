import type { Licitacion } from "./api";

export const FEED_SORT_STORAGE_KEY = "notichilec.feed-sort-mode.v1";

export const FEED_SORT_MODES = [
  "latest_published",
  "most_relevant",
  "closing_soon",
] as const;

export type FeedSortMode = (typeof FEED_SORT_MODES)[number];

export const DEFAULT_FEED_SORT_MODE: FeedSortMode = "latest_published";

export const FEED_SORT_LABELS: Record<FeedSortMode, string> = {
  latest_published: "Últimas publicadas",
  most_relevant: "Más relevantes",
  closing_soon: "Prontas a cerrar",
};

export function isFeedSortMode(value: unknown): value is FeedSortMode {
  return (
    typeof value === "string" &&
    (FEED_SORT_MODES as readonly string[]).includes(value)
  );
}

export function sanitizeFeedSortMode(value: unknown): FeedSortMode {
  return isFeedSortMode(value) ? value : DEFAULT_FEED_SORT_MODE;
}

function toTimestamp(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function getPublishedAt(item: Licitacion): number {
  const publishedAt = toTimestamp(item.fechaPublicacion);
  if (Number.isFinite(publishedAt)) return publishedAt;
  return toTimestamp(item.createdAt);
}

function getCreatedAt(item: Licitacion): number {
  return toTimestamp(item.createdAt);
}

function getClosingRank(item: Licitacion, now: number): number {
  if (item.estado !== "Publicada") return Number.NEGATIVE_INFINITY;

  const closingAt = toTimestamp(item.fechaCierre);
  if (!Number.isFinite(closingAt) || closingAt < now) {
    return Number.NEGATIVE_INFINITY;
  }

  return -closingAt;
}

function getRelevanceBucket(item: Licitacion, now: number): number {
  const closingAt = toTimestamp(item.fechaCierre);
  const isOpen =
    item.estado === "Publicada" &&
    (!Number.isFinite(closingAt) || closingAt >= now);

  return isOpen ? 1 : 0;
}

function getMontoRank(item: Licitacion): number {
  return item.montoEstimado ?? 0;
}

function compareDesc(left: number, right: number): number {
  return right - left;
}

export function compareLicitacionesBySortMode(
  left: Licitacion,
  right: Licitacion,
  sortMode: FeedSortMode,
  now: number = Date.now()
): number {
  if (sortMode === "closing_soon") {
    const byClosingRank = compareDesc(
      getClosingRank(left, now),
      getClosingRank(right, now)
    );
    if (byClosingRank !== 0) return byClosingRank;
  }

  if (sortMode === "most_relevant") {
    const byBucket = compareDesc(
      getRelevanceBucket(left, now),
      getRelevanceBucket(right, now)
    );
    if (byBucket !== 0) return byBucket;

    const byMonto = compareDesc(getMontoRank(left), getMontoRank(right));
    if (byMonto !== 0) return byMonto;
  }

  const byPublishedAt = compareDesc(getPublishedAt(left), getPublishedAt(right));
  if (byPublishedAt !== 0) return byPublishedAt;

  const byCreatedAt = compareDesc(getCreatedAt(left), getCreatedAt(right));
  if (byCreatedAt !== 0) return byCreatedAt;

  return right.id.localeCompare(left.id);
}
