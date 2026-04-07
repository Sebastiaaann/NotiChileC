import { Platform } from "react-native";
import {
  getDemoDataMode,
  isDemoApp,
} from "./app-env";
import {
  getDemoLicitacionById,
  getDemoLicitaciones,
  getDemoRegions,
  getDemoRubros,
  type DemoLicitacion,
} from "./demo-data";
import type { FeedFilters } from "./feed-filters";
import type {
  InstallationPreferencesPayload,
  InstallationSyncPayload,
} from "./installation-types";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`API error ${status}: ${body}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

// ── Tipos ───────────────────────────────────────────

export interface Licitacion {
  id: string;
  codigoExterno: string;
  nombre: string;
  organismoNombre: string | null;
  tipo: string | null;
  montoEstimado: number | null;
  montoLabel: string | null;
  moneda: string;
  fechaPublicacion: string | null;
  fechaCierre: string | null;
  estado: string;
  url: string | null;
  region: string | null;
  categoria: string;
  createdAt: string;
}

export interface Rubro {
  code: string;
  name: string;
  parentCode: string | null;
}

export interface RegionOption {
  name: string;
}

export interface CursorPageInfo {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
  windowDays: number;
  windowStart: string;
}

export interface CursorPaginatedResponse {
  data: Licitacion[];
  pageInfo: CursorPageInfo;
}

type DemoCursor = {
  createdAt: string;
  id: string;
};

// ── Helpers ─────────────────────────────────────────

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_URL}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ApiError(response.status, body);
  }

  return response.json() as Promise<T>;
}

function demoModeUsesFallback(): boolean {
  return isDemoApp() && getDemoDataMode() !== "live";
}

function demoModeForcesFallback(): boolean {
  return isDemoApp() && getDemoDataMode() === "fallback";
}

function serializeDemoCursor(value: DemoCursor): string {
  return encodeURIComponent(JSON.stringify(value));
}

function parseDemoCursor(value: string | null | undefined): DemoCursor | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Partial<DemoCursor>;
    if (
      typeof parsed.createdAt !== "string" ||
      typeof parsed.id !== "string"
    ) {
      return null;
    }

    return {
      createdAt: parsed.createdAt,
      id: parsed.id,
    };
  } catch {
    return null;
  }
}

function compareDemoCursor(item: Pick<Licitacion, "createdAt" | "id">, cursor: DemoCursor) {
  const createdAtDiff =
    new Date(item.createdAt).getTime() - new Date(cursor.createdAt).getTime();

  if (createdAtDiff !== 0) {
    return createdAtDiff;
  }

  return item.id.localeCompare(cursor.id);
}

function paginateDemoLicitaciones(
  items: Licitacion[],
  limit: number,
  cursor: string | null | undefined,
  windowDays: number
): CursorPaginatedResponse {
  const decodedCursor = parseDemoCursor(cursor);
  const filtered = decodedCursor
    ? items.filter((item) => compareDemoCursor(item, decodedCursor) < 0)
    : items;

  const pageRows = filtered.slice(0, limit);
  const hasMore = filtered.length > limit;
  const nextCursor =
    hasMore && pageRows.length > 0
      ? serializeDemoCursor({
          createdAt: pageRows[pageRows.length - 1]!.createdAt,
          id: pageRows[pageRows.length - 1]!.id,
        })
      : null;

  return {
    data: pageRows,
    pageInfo: {
      limit,
      hasMore,
      nextCursor,
      windowDays,
      windowStart: new Date(
        Date.now() - windowDays * 24 * 60 * 60 * 1000
      ).toISOString(),
    },
  };
}

function mapDemoLicitacion(item: DemoLicitacion): Licitacion {
  return {
    id: item.id,
    codigoExterno: item.codigoExterno,
    nombre: item.nombre,
    organismoNombre: item.organismoNombre,
    tipo: item.tipo,
    montoEstimado: item.montoEstimado,
    montoLabel: item.montoLabel,
    moneda: item.moneda,
    fechaPublicacion: item.fechaPublicacion,
    fechaCierre: item.fechaCierre,
    estado: item.estado,
    url: item.url,
    region: item.region,
    categoria: item.categoria,
    createdAt: item.createdAt,
  };
}

async function withDemoFallback<T>(
  liveCall: () => Promise<T>,
  fallback: () => T,
  shouldFallback: (value: T) => boolean = () => false
): Promise<T> {
  if (demoModeForcesFallback()) {
    return fallback();
  }

  try {
    const value = await liveCall();
    if (demoModeUsesFallback() && shouldFallback(value)) {
      return fallback();
    }

    return value;
  } catch (error) {
    if (demoModeUsesFallback()) {
      return fallback();
    }

    throw error;
  }
}

// ── API pública ─────────────────────────────────────

/**
 * Registra el token push del dispositivo en el backend.
 */
export async function registerDevice(expoPushToken: string): Promise<void> {
  await fetchApi("/api/devices/register", {
    method: "POST",
    body: JSON.stringify({
      expoPushToken,
      platform: Platform.OS,
    }),
  });
}

export async function syncInstallation(
  installationId: string,
  payload: InstallationSyncPayload
): Promise<void> {
  await fetchApi(`/api/installations/${encodeURIComponent(installationId)}/sync`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function getInstallationPreferences(
  installationId: string
): Promise<InstallationPreferencesPayload> {
  return fetchApi<InstallationPreferencesPayload>(
    `/api/installations/${encodeURIComponent(installationId)}/preferences`
  );
}

export async function updateInstallationPreferences(
  installationId: string,
  payload: InstallationPreferencesPayload
): Promise<void> {
  await fetchApi(
    `/api/installations/${encodeURIComponent(installationId)}/preferences`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );
}

export async function registerTokenWithRetry(
  expoPushToken: string,
  maxRetries: number = 3
): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await registerDevice(expoPushToken);
      console.log("[api] Token registrado exitosamente en intento", attempt + 1);
      return;
    } catch (error) {
      const isLastAttempt = attempt === maxRetries - 1;
      if (isLastAttempt) {
        console.error(
          `[api] Falló registro de token después de ${maxRetries} intentos:`,
          error
        );
        return; // No bloquear al usuario
      }
      const delayMs = 1000 * Math.pow(2, attempt); // 1s, 2s
      console.warn(
        `[api] Intento ${attempt + 1}/${maxRetries} falló, reintentando en ${delayMs}ms`
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

/**
 * Obtiene la lista de licitaciones paginada.
 */
export async function fetchLicitaciones(
  options: {
    cursor?: string | null;
    limit?: number;
    windowDays?: number;
    filters?: Partial<FeedFilters>;
  } = {}
): Promise<CursorPaginatedResponse> {
  const limit = options.limit ?? 20;
  const windowDays = options.windowDays ?? 90;

  if (demoModeForcesFallback()) {
    return paginateDemoLicitaciones(
      getDemoLicitaciones(options.filters).map(mapDemoLicitacion),
      limit,
      options.cursor,
      windowDays
    );
  }

  const params = new URLSearchParams({
    limit: String(limit),
    windowDays: String(windowDays),
  });

  if (options.cursor) {
    params.append("cursor", options.cursor);
  }

  if (options.filters?.rubro) params.append("rubro", options.filters.rubro);
  if (options.filters?.tipo) params.append("tipo", options.filters.tipo);
  if (options.filters?.region) params.append("region", options.filters.region);
  if (
    options.filters?.montoMin !== null &&
    options.filters?.montoMin !== undefined
  ) {
    params.append("montoMin", String(options.filters.montoMin));
  }
  if (
    options.filters?.montoMax !== null &&
    options.filters?.montoMax !== undefined
  ) {
    params.append("montoMax", String(options.filters.montoMax));
  }

  return withDemoFallback(
    () =>
      fetchApi<CursorPaginatedResponse>(`/api/licitaciones?${params.toString()}`),
    () =>
      paginateDemoLicitaciones(
        getDemoLicitaciones(options.filters).map(mapDemoLicitacion),
        limit,
        options.cursor,
        windowDays
      ),
    (response) => response.data.length === 0
  );
}

export async function fetchRubros(): Promise<{ data: Rubro[] }> {
  return withDemoFallback(
    () => fetchApi<{ data: Rubro[] }>("/api/rubros"),
    () => ({ data: getDemoRubros() }),
    (response) => response.data.length === 0
  );
}

export async function fetchRegions(): Promise<{ data: RegionOption[] }> {
  return withDemoFallback(
    () => fetchApi<{ data: RegionOption[] }>("/api/licitaciones/regions"),
    () => ({ data: getDemoRegions() }),
    (response) => response.data.length === 0
  );
}

/**
 * Obtiene el detalle de una licitación por ID.
 */
export async function fetchLicitacion(
  id: string
): Promise<{ data: Licitacion }> {
  return withDemoFallback(
    () =>
      fetchApi<{ data: Licitacion }>(
        `/api/licitaciones/${encodeURIComponent(id)}`
      ),
    () => {
      const fallback = getDemoLicitacionById(id);
      if (!fallback) {
        throw new Error("Licitación demo no encontrada");
      }

      return { data: mapDemoLicitacion(fallback) };
    }
  );
}
