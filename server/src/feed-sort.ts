export const FEED_SORT_MODES = [
  "latest_published",
  "most_relevant",
  "closing_soon",
] as const;

export type FeedSortMode = (typeof FEED_SORT_MODES)[number];

export const DEFAULT_FEED_SORT_MODE: FeedSortMode = "latest_published";

export function isFeedSortMode(value: unknown): value is FeedSortMode {
  return (
    typeof value === "string" &&
    (FEED_SORT_MODES as readonly string[]).includes(value)
  );
}

export function sanitizeFeedSortMode(value: unknown): FeedSortMode {
  return isFeedSortMode(value) ? value : DEFAULT_FEED_SORT_MODE;
}
