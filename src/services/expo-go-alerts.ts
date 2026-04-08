import { AppState, type AppStateStatus } from "react-native";
import type { Licitacion } from "./api";
import { fetchLicitaciones } from "./api";
import {
  DEFAULT_FEED_FILTERS,
  FEED_FILTERS_STORAGE_KEY,
  sanitizeFeedFilters,
  type FeedFilters,
} from "./feed-filters";
import { DEFAULT_FEED_SORT_MODE } from "./feed-sort";
import { localStorage } from "./local-storage";
import {
  ensureNotificationPermissions,
  isRunningInExpoGo,
  scheduleImmediateLocalNotification,
} from "./push";

const HOT_WINDOW_DAYS = 90;
const POLL_INTERVAL_MS = 30_000;
const SEEN_IDS_STORAGE_KEY = "notichilec.expo-go-alerts.seen-ids.v1";
const MAX_SEEN_IDS = 200;

const listeners = new Set<() => void>();

let started = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let appState: AppStateStatus = AppState.currentState;
let pollInFlight = false;

function notifyListeners() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      if (__DEV__) {
        console.warn("[expo-go-alerts] Listener falló:", error);
      }
    }
  });
}

function formatSeenIds(ids: string[]): string {
  return JSON.stringify(ids.slice(0, MAX_SEEN_IDS));
}

async function readSeenIds(): Promise<string[]> {
  try {
    const raw = await localStorage.getItem(SEEN_IDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch (error) {
    if (__DEV__) {
      console.warn("[expo-go-alerts] No se pudo leer seen ids:", error);
    }
    return [];
  }
}

async function writeSeenIds(ids: string[]): Promise<void> {
  try {
    await localStorage.setItem(SEEN_IDS_STORAGE_KEY, formatSeenIds(ids));
  } catch (error) {
    if (__DEV__) {
      console.warn("[expo-go-alerts] No se pudo guardar seen ids:", error);
    }
  }
}

async function readStoredFilters(): Promise<FeedFilters> {
  try {
    const raw = await localStorage.getItem(FEED_FILTERS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_FEED_FILTERS };
    return sanitizeFeedFilters(JSON.parse(raw));
  } catch (error) {
    if (__DEV__) {
      console.warn("[expo-go-alerts] No se pudieron leer filtros guardados:", error);
    }
    return { ...DEFAULT_FEED_FILTERS };
  }
}

function buildNotificationBody(licitacion: Licitacion): string {
  return licitacion.montoLabel
    ? `${licitacion.nombre} — ${licitacion.montoLabel}`
    : licitacion.nombre;
}

async function scheduleNotifications(items: Licitacion[]): Promise<void> {
  const orderedItems = [...items].reverse();

  for (const item of orderedItems) {
    try {
      await scheduleImmediateLocalNotification({
        title: "📋 Nueva Licitación",
        body: buildNotificationBody(item),
        data: {
          licitacionId: item.id,
          codigo: item.codigoExterno,
          type: "expo_go_new_licitacion",
        },
      });
    } catch (error) {
      if (__DEV__) {
        console.warn("[expo-go-alerts] No se pudo agendar alerta local:", error);
      }
    }
  }
}

async function pollForNewLicitaciones(): Promise<void> {
  if (!isRunningInExpoGo() || appState !== "active" || pollInFlight) {
    return;
  }

  pollInFlight = true;

  try {
    const filters = await readStoredFilters();
    const response = await fetchLicitaciones({
      cursor: null,
      limit: 20,
      windowDays: HOT_WINDOW_DAYS,
      filters,
      sortMode: DEFAULT_FEED_SORT_MODE,
    });

    const currentIds = response.data.map((item) => item.id);
    const seenIds = await readSeenIds();

    if (seenIds.length === 0) {
      await writeSeenIds(currentIds);
      return;
    }

    const seenSet = new Set(seenIds);
    const newItems = response.data.filter((item) => !seenSet.has(item.id));

    if (newItems.length === 0) {
      await writeSeenIds([...currentIds, ...seenIds]);
      return;
    }

    await writeSeenIds([...currentIds, ...seenIds]);
    notifyListeners();
    await scheduleNotifications(newItems);
  } catch (error) {
    if (__DEV__) {
      console.warn("[expo-go-alerts] Polling de nuevas licitaciones falló:", error);
    }
  } finally {
    pollInFlight = false;
  }
}

function startPollingLoop() {
  if (intervalHandle !== null) {
    clearInterval(intervalHandle);
  }

  intervalHandle = setInterval(() => {
    void pollForNewLicitaciones();
  }, POLL_INTERVAL_MS);
}

export function startExpoGoAlerts(): void {
  if (started || !isRunningInExpoGo()) {
    return;
  }

  started = true;
  startPollingLoop();
  void ensureNotificationPermissions();
  AppState.addEventListener("change", (nextState) => {
    appState = nextState;

    if (nextState === "active") {
      void pollForNewLicitaciones();
    }
  });

  void pollForNewLicitaciones();
}

export function subscribeToExpoGoAlertRefresh(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}
