export interface DemoFixtureLicitacion {
  id: string;
  codigo_externo: string;
  nombre: string;
  organismo_nombre: string | null;
  tipo: string | null;
  monto_estimado: number | null;
  monto_label: string | null;
  moneda: string;
  fecha_publicacion: string | null;
  fecha_cierre: string | null;
  estado: string;
  url: string | null;
  region: string | null;
  categoria: string;
  rubro_code: string | null;
  created_at: string;
}

const baseDate = new Date("2026-04-06T12:00:00.000Z");

function hoursAgo(hours: number) {
  return new Date(baseDate.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function daysFromNow(days: number) {
  return new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export const DEMO_FIXTURE_LICITACIONES: DemoFixtureLicitacion[] = [
  {
    id: "demo-licitacion-001",
    codigo_externo: "DEMO-2026-001",
    nombre: "Conservación de multicanchas y espacios públicos comunales",
    organismo_nombre: "Municipalidad de La Florida",
    tipo: "LQ",
    monto_estimado: 185000000,
    monto_label: "$185.000.000",
    moneda: "CLP",
    fecha_publicacion: hoursAgo(4),
    fecha_cierre: daysFromNow(9),
    estado: "Publicada",
    url: "https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=DEMO-2026-001",
    region: "Región Metropolitana",
    categoria: "Infraestructura",
    rubro_code: "721317",
    created_at: hoursAgo(3),
  },
  {
    id: "demo-licitacion-002",
    codigo_externo: "DEMO-2026-002",
    nombre: "Reposición de veredas y accesibilidad universal sector centro",
    organismo_nombre: "Municipalidad de Viña del Mar",
    tipo: "LP",
    monto_estimado: 92000000,
    monto_label: "$92.000.000",
    moneda: "CLP",
    fecha_publicacion: hoursAgo(12),
    fecha_cierre: daysFromNow(6),
    estado: "Publicada",
    url: "https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=DEMO-2026-002",
    region: "Región de Valparaíso",
    categoria: "Obras civiles",
    rubro_code: "721022",
    created_at: hoursAgo(11),
  },
  {
    id: "demo-licitacion-003",
    codigo_externo: "DEMO-2026-003",
    nombre: "Diseño de ingeniería para mejoramiento vial de acceso norte",
    organismo_nombre: "Gobierno Regional del Biobío",
    tipo: "LE",
    monto_estimado: 35000000,
    monto_label: "$35.000.000",
    moneda: "CLP",
    fecha_publicacion: hoursAgo(30),
    fecha_cierre: daysFromNow(14),
    estado: "Publicada",
    url: "https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=DEMO-2026-003",
    region: "Región del Biobío",
    categoria: "Ingeniería",
    rubro_code: "811015",
    created_at: hoursAgo(28),
  },
  {
    id: "demo-licitacion-004",
    codigo_externo: "DEMO-2026-004",
    nombre: "Mantención correctiva de recintos deportivos municipales",
    organismo_nombre: "Municipalidad de Maipú",
    tipo: "LQ",
    monto_estimado: 128000000,
    monto_label: "$128.000.000",
    moneda: "CLP",
    fecha_publicacion: hoursAgo(42),
    fecha_cierre: daysFromNow(3),
    estado: "Publicada",
    url: "https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=DEMO-2026-004",
    region: "Región Metropolitana",
    categoria: "Infraestructura",
    rubro_code: "721317",
    created_at: hoursAgo(41),
  },
];
