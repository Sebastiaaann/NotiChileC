import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const workerRuns = pgTable("worker_runs", {
  id: serial("id").primaryKey(),
  worker_name: text("worker_name").notNull().default("sync"),
  started_at: timestamp("started_at", { withTimezone: true }).notNull(),
  finished_at: timestamp("finished_at", { withTimezone: true }),
  licitaciones_found: integer("licitaciones_found").notNull().default(0),
  licitaciones_new: integer("licitaciones_new").notNull().default(0),
  notifications_sent: integer("notifications_sent").notNull().default(0),
  notifications_retryable: integer("notifications_retryable").notNull().default(0),
  notifications_failed: integer("notifications_failed").notNull().default(0),
  notifications_invalidated: integer("notifications_invalidated").notNull().default(0),
  targets_selected: integer("targets_selected").notNull().default(0),
  deliveries_created: integer("deliveries_created").notNull().default(0),
  receipts_processed: integer("receipts_processed").notNull().default(0),
  archived_licitaciones: integer("archived_licitaciones").notNull().default(0),
  archived_deliveries: integer("archived_deliveries").notNull().default(0),
  error_message: text("error_message"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
