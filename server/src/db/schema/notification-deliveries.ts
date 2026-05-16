import { bigint, bigserial, boolean, integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { notificationEvents } from "./notification-events";
import { deviceInstallations } from "./device-installations";

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    notification_event_id: bigint("notification_event_id", { mode: "bigint" })
      .notNull()
      .references(() => notificationEvents.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    installation_id: text("installation_id")
      .notNull()
      .references(() => deviceInstallations.installation_id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    provider: text("provider").notNull().default("expo"),
    status: text("status").notNull().default("pending"),
    next_attempt_at: timestamp("next_attempt_at", { withTimezone: true }),
    locked_at: timestamp("locked_at", { withTimezone: true }),
    locked_by: text("locked_by"),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    provider_ticket_id: text("provider_ticket_id"),
    provider_receipt_id: text("provider_receipt_id"),
    attempt_count: integer("attempt_count").notNull().default(0),
    last_error_code: text("last_error_code"),
    last_error_message: text("last_error_message"),
    last_attempt_at: timestamp("last_attempt_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueEventInstallation: unique().on(table.notification_event_id, table.installation_id),
  }),
);
