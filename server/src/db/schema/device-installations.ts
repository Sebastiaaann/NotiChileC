import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const deviceInstallations = pgTable("device_installations", {
  installation_id: text("installation_id").primaryKey(),
  push_token: text("push_token").unique(),
  platform: text("platform").notNull().default("unknown"),
  environment: text("environment").notNull().default("development"),
  app_version: text("app_version").notNull().default("unknown"),
  push_capable: boolean("push_capable").notNull().default(false),
  permission_status: text("permission_status").notNull().default("undetermined"),
  active: boolean("active").notNull().default(false),
  invalidated_at: timestamp("invalidated_at", { withTimezone: true }),
  invalid_reason: text("invalid_reason"),
  last_seen_at: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
