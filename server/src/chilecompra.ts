// Cliente de la API de Mercado Público (ChileCompra)
// Basado en la implementación del proyecto anterior

const API_BASE_URL =
  "https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json";
const DEFAULT_RETRIES = 3;
const BACKOFF_MS = 1_500;

// ── Tipos ───────────────────────────────────────────────

export interface ChileCompraSummaryItem {
  CodigoEstado?: number | string | null;
  CodigoExterno: string;
  FechaCierre?: string | null;
  Nombre?: string | null;
}

export interface ChileCompraDetailItem {
  CodigoExterno?: string | null;
  Nombre?: string | null;
  Estado?: string | null;
  Tipo?: string | null;
  FechaCierre?: string | null;
  FechaPublicacion?: string | null;
  Moneda?: string | null;
  MontoEstimado?: number | string | null;
  Comprador?: {
    NombreOrganismo?: string | null;
    NombreUnidad?: string | null;
    RegionUnidad?: string | null;
  } | null;
  Fechas?: {
    FechaPublicacion?: string | null;
    FechaCierre?: string | null;
  } | null;
  Items?: {
    Listado?:
      | Array<{ Categoria?: string | null }>
      | { Categoria?: string | null }
      | null;
  } | null;
  [key: string]: unknown;
}

export interface LicitacionRecord {
  id: string;
  codigo_externo: string;
  nombre: string;
  organismo_nombre: string | null;
  tipo: string | null;
  monto_estimado: number | null;
  moneda: string;
  fecha_publicacion: string | null;
  fecha_cierre: string | null;
  estado: string;
  url: string;
  region: string | null;
  categoria: string;
}

// ── Helpers ─────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTicket(): string {
  const ticket = process.env.CHILECOMPRA_TICKET;
  if (!ticket) {
    throw new Error("CHILECOMPRA_TICKET no está configurado");
  }
  return ticket;
}

function formatDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Santiago",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);

  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const year = parts.find((p) => p.type === "year")?.value ?? "";

  return `${day}${month}${year}`;
}

function normalizeText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asArray<T>(value: T[] | T | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function deriveTipo(codigo: string): string | null {
  const match = codigo.match(/-(L1|LE|LP|LQ|LR)\d+$/i);
  return match ? match[1].toUpperCase() : null;
}

function extractCategoria(detail: ChileCompraDetailItem): string {
  const items = detail.Items?.Listado;
  if (Array.isArray(items)) {
    return normalizeText(items[0]?.Categoria) ?? "General";
  }
  if (items && typeof items === "object") {
    return normalizeText((items as { Categoria?: string }).Categoria) ?? "General";
  }
  return "General";
}

// ── API calls con retry ─────────────────────────────────

async function fetchJson<T>(params: Record<string, string>): Promise<T> {
  const url = new URL(API_BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("ticket", getTicket());

  let lastError: unknown;

  for (let attempt = 0; attempt <= DEFAULT_RETRIES; attempt++) {
    try {
      const response = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15000)
      });

      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;

      if (!response.ok) {
        const retryable = response.status >= 500 || response.status === 429;
        if (!retryable || attempt === DEFAULT_RETRIES) {
          throw new Error(`API respondió ${response.status}`);
        }
        await sleep(BACKOFF_MS * (attempt + 1));
        continue;
      }

      if (!body) {
        throw new Error("API respondió sin payload");
      }

      // Check for API-level errors
      const code = typeof body.Codigo === "number" ? body.Codigo : null;
      if (code) {
        throw new Error(
          (body.Mensaje as string) || `Error API código ${code}`
        );
      }

      return body as T;
    } catch (error) {
      console.error(`[chilecompra] Intento ${attempt + 1} falló:`, error);
      lastError = error;
      if (attempt < DEFAULT_RETRIES) {
        await sleep(BACKOFF_MS * (attempt + 1));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Fallo desconocido");
}

// ── Public API ──────────────────────────────────────────

interface SummaryResponse {
  Cantidad: number;
  Listado: ChileCompraSummaryItem[] | ChileCompraSummaryItem;
}

interface DetailResponse {
  Listado: ChileCompraDetailItem[] | ChileCompraDetailItem;
}

export async function fetchLicitacionesSummary(
  date: Date
): Promise<ChileCompraSummaryItem[]> {
  console.log(`[chilecompra] fetchLicitacionesSummary para ${formatDate(date)}`);
  const payload = await fetchJson<SummaryResponse>({
    fecha: formatDate(date),
    estado: "publicada",
  });
  console.log(`[chilecompra] Respuesta recibida, ${asArray(payload.Listado).length} items`);

  return asArray(payload.Listado).filter(
    (item) => String(item.CodigoExterno ?? "").trim().length > 0
  );
}

export async function fetchLicitacionDetail(
  codigo: string
): Promise<ChileCompraDetailItem> {
  const payload = await fetchJson<DetailResponse>({ codigo });
  const item = asArray(payload.Listado)[0];

  if (!item || !item.CodigoExterno) {
    throw new Error(`Sin detalle para ${codigo}`);
  }

  return item;
}

export function mapDetailToRecord(
  summary: ChileCompraSummaryItem,
  detail: ChileCompraDetailItem
): LicitacionRecord {
  const codigo =
    normalizeText(detail.CodigoExterno) ?? summary.CodigoExterno;

  const fechaPub =
    normalizeText(detail.Fechas?.FechaPublicacion) ??
    normalizeText(detail.FechaPublicacion) ??
    null;

  const fechaCierre =
    normalizeText(detail.Fechas?.FechaCierre) ??
    normalizeText(detail.FechaCierre) ??
    normalizeText(summary.FechaCierre) ??
    null;

  return {
    id: codigo,
    codigo_externo: codigo,
    nombre:
      normalizeText(detail.Nombre) ??
      normalizeText(summary.Nombre) ??
      "Sin nombre",
    organismo_nombre:
      normalizeText(detail.Comprador?.NombreOrganismo) ??
      normalizeText(detail.Comprador?.NombreUnidad) ??
      null,
    tipo:
      normalizeText(detail.Tipo)?.toUpperCase() ?? deriveTipo(codigo),
    monto_estimado: toNumber(detail.MontoEstimado),
    moneda: normalizeText(detail.Moneda)?.toUpperCase() ?? "CLP",
    fecha_publicacion: fechaPub,
    fecha_cierre: fechaCierre,
    estado: normalizeText(detail.Estado) ?? "Publicada",
    url: `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(codigo)}`,
    region: normalizeText(detail.Comprador?.RegionUnidad),
    categoria: extractCategoria(detail),
  };
}
