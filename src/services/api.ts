import { Platform } from "react-native";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

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

export interface PaginatedResponse {
  data: Licitacion[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
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
    throw new Error(`API error ${response.status}: ${body}`);
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
  page: number = 1,
  pageSize: number = 20
): Promise<PaginatedResponse> {
  return fetchApi<PaginatedResponse>(
    `/api/licitaciones?page=${page}&pageSize=${pageSize}`
  );
}

/**
 * Obtiene el detalle de una licitación por ID.
 */
export async function fetchLicitacion(
  id: string
): Promise<{ data: Licitacion }> {
  return fetchApi<{ data: Licitacion }>(`/api/licitaciones/${encodeURIComponent(id)}`);
}
