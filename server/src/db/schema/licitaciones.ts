import { boolean, integer, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const licitaciones = pgTable("licitaciones", {
  id: text("id").primaryKey(),
  codigo_externo: text("codigo_externo").notNull(),
  nombre: text("nombre").notNull(),
  organismo_nombre: text("organismo_nombre"),
  tipo: text("tipo"),
  monto_estimado: numeric("monto_estimado", { precision: 14, scale: 0 }),
  monto_label: text("monto_label"),
  moneda: text("moneda").notNull().default("CLP"),
  fecha_publicacion: timestamp("fecha_publicacion", { withTimezone: true }),
  fecha_cierre: timestamp("fecha_cierre", { withTimezone: true }),
  estado: text("estado").notNull().default("Publicada"),
  url: text("url"),
  region: text("region"),
  categoria: text("categoria").notNull().default("General"),
  rubro_code: text("rubro_code"),
  source_rank: integer("source_rank"),
  notificada: boolean("notificada").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
