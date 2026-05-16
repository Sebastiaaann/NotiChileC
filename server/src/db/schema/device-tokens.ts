import { boolean, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const deviceTokens = pgTable("device_tokens", {
  id: serial("id").primaryKey(),
  expo_push_token: text("expo_push_token").notNull().unique(),
  installation_id: text("installation_id"),
  platform: text("platform").notNull().default("unknown"),
  active: boolean("active").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  last_seen_at: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});
