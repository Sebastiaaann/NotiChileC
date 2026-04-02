// Scraper de respaldo para ChileCompra cuando la API está caída
// Usa el endpoint interno del buscador web de mercadopublico.cl

import type { ChileCompraSummaryItem, LicitacionRecord } from "./chilecompra";
import { workerLogger } from "./observability/logger";

const SEARCH_URL =
  "https://www.mercadopublico.cl/BuscarLicitacion/Home/Buscar";

// ── Helpers ─────────────────────────────────────────────

function extractBetween(
  html: string,
  startMarker: string,
  endMarker: string
): string[] {
  const results: string[] = [];
  let pos = 0;
  while (true) {
    const start = html.indexOf(startMarker, pos);
    if (start === -1) break;
    const end = html.indexOf(endMarker, start + startMarker.length);
    if (end === -1) break;
    results.push(html.substring(start + startMarker.length, end));
    pos = end + endMarker.length;
  }
  return results;
}

function cleanHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, "") // remove tags
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code))) // decode HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractRegex(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  return match ? cleanHtml(match[1]) : null;
}

// ── Parser de HTML ──────────────────────────────────────

export interface ScrapedLicitacion {
  codigoExterno: string;
  nombre: string;
  tipo: string;
  montoTexto: string;
  fechaPublicacion: string;
  fechaCierre: string;
  organismo: string | null;
  url: string | null;
  rubro: string | null;
}

function parseHtmlLicitaciones(html: string): ScrapedLicitacion[] {
  // Cada licitación está en un bloque <div class="lic-bloq-wrap ...">
  const blocks = html.split('class="lic-bloq-wrap');
  const results: ScrapedLicitacion[] = [];

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];

    // ID Licitación: <span class="clearfix"> 1233613-27-CO26</span>
    const codigo = extractRegex(
      block,
      /<span class="clearfix">\s*([^<]+)<\/span>/
    );
    if (!codigo) continue;

    // Tipo: <span>CO</span> dentro de estado-lic
    const tipo = extractRegex(
      block,
      /<div class="estado-lic">\s*<strong><span>([^<]+)<\/span>/
    );

    // Nombre: <h2 class="text-weight-light">NOMBRE</h2>
    const nombre = extractRegex(
      block,
      /<h2 class="text-weight-light">([^<]+)<\/h2>/
    );

    // Monto: puede ser numérico o texto descriptivo
    let montoTexto = "";
    const montoNum = extractRegex(
      block,
      /campo-numerico-punto-coma">([^<]+)<\/span>/
    );
    if (montoNum) {
      montoTexto = montoNum;
    } else {
      // Buscar texto de monto como "Entre 100 y 1000 UTM"
      const montoRange = extractRegex(
        block,
        /<p><strong>Monto[^<]*<\/strong><\/p>\s*<span[^>]*>([^<]+)<\/span>/
      );
      if (montoRange) {
        montoTexto = montoRange;
      }
    }

    // Fechas: hay 2 spans con highlight-text text-weight-light
    const fechaMatches = [
      ...block.matchAll(
        /<span class="highlight-text text-weight-light">(\d{2}\/\d{2}\/\d{4})<\/span>/g
      ),
    ];
    const fechaPublicacion = fechaMatches[0]?.[1] ?? "";
    const fechaCierre = fechaMatches[1]?.[1] ?? "";

    // Organismo: primer <strong> en el footer
    const organismo = extractRegex(
      block,
      /<div class="col-md-4"><strong>([^<]+)<\/strong>/
    );

    const rubroRegex = /Rubro[^>]*>\s*([^<]+)/i;
    const rubroSpan = new RegExp(
      '<span[^>]*class="[^"]*rubro[^"]*"[^>]*>\\s*([^<]+)<',
      "i"
    );
    const rubroText =
      extractRegex(block, rubroRegex) ?? extractRegex(block, rubroSpan);
    const rubro = rubroText?.match(/\b\d{8}\b/)?.[0] ?? null;

    // URL real de la ficha: verFicha('http://...')
    const url = extractRegex(
      block,
      /verFicha\('([^']+)'\)/
    );

    results.push({
      codigoExterno: codigo.trim(),
      nombre: nombre ?? "Sin nombre",
      tipo: tipo ?? "",
      montoTexto,
      fechaPublicacion,
      fechaCierre,
      organismo: organismo ?? null,
      url: url ?? null,
      rubro,
    });
  }

  return results;
}

// ── Conversión a formato API ────────────────────────────

function parseMonto(texto: string): number | null {
  if (!texto) return null;
  // "19.800.000" → 19800000 | "Entre 100 y 1000 UTM" → null
  if (texto.includes("UTM") || texto.includes("superior") || texto.includes("Menor")) {
    return null; // Monto descriptivo, no numérico
  }
  const cleaned = texto.replace(/\./g, "").replace(/[^0-9]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function parseFecha(ddmmyyyy: string): string | null {
  if (!ddmmyyyy) return null;
  const parts = ddmmyyyy.split("/");
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;
  // Retornar en formato ISO para consistencia con la API
  return `${yyyy}-${mm}-${dd}T12:00:00`;
}

function toSummaryItem(scraped: ScrapedLicitacion): ChileCompraSummaryItem {
  return {
    CodigoExterno: scraped.codigoExterno,
    Nombre: scraped.nombre,
    FechaCierre: parseFecha(scraped.fechaCierre),
  };
}

// ── API pública ─────────────────────────────────────────

export interface ScrapeResult {
  items: ScrapedLicitacion[];
  source: "scraper";
  total: number;
}

/**
 * Convierte datos scrapeados a LicitacionRecord para insertar en DB.
 */
export function scrapedToRecord(scraped: ScrapedLicitacion): LicitacionRecord {
  const montoNum = parseMonto(scraped.montoTexto);
  return {
    id: scraped.codigoExterno,
    codigo_externo: scraped.codigoExterno,
    nombre: scraped.nombre || "Sin nombre",
    organismo_nombre: scraped.organismo,
    tipo: scraped.tipo || null,
    monto_estimado: montoNum,
    monto_label: montoNum ? null : (scraped.montoTexto || null),
    moneda: "CLP",
    fecha_publicacion: parseFecha(scraped.fechaPublicacion) ?? new Date().toISOString(),
    fecha_cierre: parseFecha(scraped.fechaCierre),
    estado: "Publicada",
    url: scraped.url ?? `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(scraped.codigoExterno)}`,
    region: null,
    categoria: scraped.rubro ?? "General",
    rubro_code: scraped.rubro,
  };
}

/**
 * Scrapea licitaciones publicadas desde la web de ChileCompra
 * como respaldo cuando la API está caída.
 *
 * @param maxPages - Máximo de páginas a scrapear (default 10 = ~100 licitaciones)
 * @param filtros - Filtros opcionales
 */
export async function scrapeLicitaciones(
  maxPages: number = 10,
  filtros?: {
    codigoRegion?: number;
    idTipoLicitacion?: number;
  }
): Promise<ScrapeResult> {
  const allItems: ScrapedLicitacion[] = [];
  let totalFound = 0;

  for (let pagina = 0; pagina < maxPages; pagina++) {
    try {
      const body = JSON.stringify({
        textoBusqueda: "",
        idEstado: -1, // Todos los estados (igual que la web)
        codigoRegion: filtros?.codigoRegion ?? -1,
        idTipoLicitacion: filtros?.idTipoLicitacion ?? -1,
        fechaInicio: null,
        fechaFin: null,
        registrosPorPagina: 10,
        idTipoFecha: 1,
        idOrden: 3, // Últimas publicadas
        compradores: [],
        garantias: [],
        rubros: [],
        proveedores: [],
        montoEstimadoTipo: [0],
        esPublicoMontoEstimado: [],
        pagina,
      });

      const response = await fetch(SEARCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body,
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        workerLogger.error("scraper_http_error", {
          job: "ingest",
          page: pagina,
          error_code: "scraper_http_error",
          status_code: response.status,
        });
        continue;
      }

      const html = await response.text();

      // Extraer total de resultados (primera página)
      if (pagina === 0) {
        const totalMatch = html.match(
          /<span class='n-result'>([^<]+)<\/span>/
        );
        if (totalMatch) {
          totalFound = Number(totalMatch[1].replace(/\./g, "")) || 0;
        }
      }

      const scraped = parseHtmlLicitaciones(html);
      workerLogger.info("scraper_page_parsed", {
        job: "ingest",
        page: pagina,
        parsed_count: scraped.length,
      });

      allItems.push(...scraped);

      // Si la página devolvió menos de 10, no hay más páginas
      if (scraped.length < 10) break;
    } catch (error) {
      workerLogger.error("scraper_page_failed", {
        job: "ingest",
        page: pagina,
        error_code: "scraper_page_failed",
        error: error instanceof Error ? error : new Error(String(error)),
      });
      break;
    }
  }

  workerLogger.info("scraper_total_completed", {
    job: "ingest",
    scraped_count: allItems.length,
    total_found: totalFound,
  });

  return {
    items: allItems,
    source: "scraper",
    total: totalFound,
  };
}
