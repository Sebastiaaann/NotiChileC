import type { FeedFilters } from "./feed-filters";
import {
  DEFAULT_FEED_SORT_MODE,
  compareLicitacionesBySortMode,
  type FeedSortMode,
} from "./feed-sort";

export interface DemoLicitacion {
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

export interface DemoRubro {
  code: string;
  name: string;
  parentCode: string | null;
}

export interface DemoRegionOption {
  name: string;
}

const now = new Date("2026-04-06T12:00:00.000Z");

function hoursAgo(hours: number) {
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function daysFromNow(days: number) {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export const DEMO_RUBROS: DemoRubro[] = [
  { code: "721317", name: "Construcción general", parentCode: "72" },
  { code: "721022", name: "Obras civiles", parentCode: "72" },
  { code: "811015", name: "Servicios de ingeniería", parentCode: "81" },
];

export const DEMO_REGIONS: DemoRegionOption[] = [
  { name: "Región Metropolitana" },
  { name: "Región de Valparaíso" },
  { name: "Región del Biobío" },
];

export const DEMO_LICITACIONES: DemoLicitacion[] = [
  {
    id: "demo-licitacion-001",
    codigoExterno: "DEMO-2026-001",
    nombre: "Conservación de multicanchas y espacios públicos comunales",
    organismoNombre: "Municipalidad de La Florida",
    tipo: "LQ",
    montoEstimado: 185000000,
    montoLabel: "$185.000.000",
    moneda: "CLP",
    fechaPublicacion: hoursAgo(4),
    fechaCierre: daysFromNow(9),
    estado: "Publicada",
    url: "https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=DEMO-2026-001",
    region: "Región Metropolitana",
    categoria: "Infraestructura",
    createdAt: hoursAgo(3),
  },
  {
    id: "demo-licitacion-002",
    codigoExterno: "DEMO-2026-002",
    nombre: "Reposición de veredas y accesibilidad universal sector centro",
    organismoNombre: "Municipalidad de Viña del Mar",
    tipo: "LP",
    montoEstimado: 92000000,
    montoLabel: "$92.000.000",
    moneda: "CLP",
    fechaPublicacion: hoursAgo(12),
    fechaCierre: daysFromNow(6),
    estado: "Publicada",
    url: "https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=DEMO-2026-002",
    region: "Región de Valparaíso",
    categoria: "Obras civiles",
    createdAt: hoursAgo(11),
  },
  {
    id: "demo-licitacion-003",
    codigoExterno: "DEMO-2026-003",
    nombre: "Diseño de ingeniería para mejoramiento vial de acceso norte",
    organismoNombre: "Gobierno Regional del Biobío",
    tipo: "LE",
    montoEstimado: 35000000,
    montoLabel: "$35.000.000",
    moneda: "CLP",
    fechaPublicacion: hoursAgo(30),
    fechaCierre: daysFromNow(14),
    estado: "Publicada",
    url: "https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=DEMO-2026-003",
    region: "Región del Biobío",
    categoria: "Ingeniería",
    createdAt: hoursAgo(28),
  },
  {
    id: "demo-licitacion-004",
    codigoExterno: "DEMO-2026-004",
    nombre: "Mantención correctiva de recintos deportivos municipales",
    organismoNombre: "Municipalidad de Maipú",
    tipo: "LQ",
    montoEstimado: 128000000,
    montoLabel: "$128.000.000",
    moneda: "CLP",
    fechaPublicacion: hoursAgo(42),
    fechaCierre: daysFromNow(3),
    estado: "Publicada",
    url: "https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=DEMO-2026-004",
    region: "Región Metropolitana",
    categoria: "Infraestructura",
    createdAt: hoursAgo(41),
  },
];

const DEMO_RUBRO_BY_LICITACION: Record<string, string> = {
  "demo-licitacion-001": "721317",
  "demo-licitacion-002": "721022",
  "demo-licitacion-003": "811015",
  "demo-licitacion-004": "721317",
};

export function getDemoRubros() {
  return DEMO_RUBROS;
}

export function getDemoRegions() {
  return DEMO_REGIONS;
}

export function getDemoLicitacionById(id: string) {
  return DEMO_LICITACIONES.find(
    (item) => item.id === id || item.codigoExterno === id
  ) ?? null;
}

export function getDemoLicitaciones(
  filters?: Partial<FeedFilters>,
  sortMode: FeedSortMode = DEFAULT_FEED_SORT_MODE
) {
  return DEMO_LICITACIONES.filter((item) => {
    if (filters?.rubro && DEMO_RUBRO_BY_LICITACION[item.id] !== filters.rubro) {
      return false;
    }

    if (filters?.tipo && item.tipo !== filters.tipo) {
      return false;
    }

    if (filters?.region && item.region !== filters.region) {
      return false;
    }

    if (
      filters?.montoMin !== null &&
      filters?.montoMin !== undefined &&
      (item.montoEstimado ?? 0) < filters.montoMin
    ) {
      return false;
    }

    if (
      filters?.montoMax !== null &&
      filters?.montoMax !== undefined &&
      (item.montoEstimado ?? Number.MAX_SAFE_INTEGER) > filters.montoMax
    ) {
      return false;
    }

    return true;
  }).sort((a, b) => compareLicitacionesBySortMode(a, b, sortMode));
}
