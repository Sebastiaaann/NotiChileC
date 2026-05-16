import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const licitacionRegistry = pgTable("licitacion_registry", {
  codigo_externo: text("codigo_externo").primaryKey(),
  licitacion_id: text("licitacion_id").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
