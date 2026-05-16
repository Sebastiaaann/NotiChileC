import { bigserial, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

export const notificationEvents = pgTable(
  "notification_events",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    type: text("type").notNull(),
    licitacion_id: text("licitacion_id").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueTypeLicitacion: unique().on(table.type, table.licitacion_id),
  }),
);
