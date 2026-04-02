import { Platform } from "react-native";
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
  const params = new URLSearchParams({
    limit: String(options.limit ?? 20),
    windowDays: String(options.windowDays ?? 90),
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

  return fetchApi<CursorPaginatedResponse>(
    `/api/licitaciones?${params.toString()}`
  );
}

export async function fetchRubros(): Promise<{ data: Rubro[] }> {
  return fetchApi<{ data: Rubro[] }>("/api/rubros");
}

export async function fetchRegions(): Promise<{ data: RegionOption[] }> {
  return fetchApi<{ data: RegionOption[] }>("/api/licitaciones/regions");
}

/**
 * Obtiene el detalle de una licitación por ID.
 */
export async function fetchLicitacion(
  id: string
): Promise<{ data: Licitacion }> {
  return fetchApi<{ data: Licitacion }>(`/api/licitaciones/${encodeURIComponent(id)}`);
}
