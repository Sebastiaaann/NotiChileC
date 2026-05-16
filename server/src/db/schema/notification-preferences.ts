import { boolean, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { deviceInstallations } from "./device-installations";

export const notificationPreferences = pgTable("notification_preferences", {
  installation_id: text("installation_id")
    .primaryKey()
    .references(() => deviceInstallations.installation_id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
  enabled: boolean("enabled").notNull().default(true),
  rubro: text("rubro"),
  tipo: text("tipo"),
  region: text("region"),
  monto_min: numeric("monto_min", { precision: 14, scale: 0 }),
  monto_max: numeric("monto_max", { precision: 14, scale: 0 }),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
