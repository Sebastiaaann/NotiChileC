import { bigserial, integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

export const archiveExports = pgTable(
  "archive_exports",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    entity: text("entity").notNull(),
    partition_month: text("partition_month").notNull(),
    object_key: text("object_key").notNull(),
    row_count: integer("row_count").notNull(),
    min_created_at: timestamp("min_created_at", { withTimezone: true }),
    max_created_at: timestamp("max_created_at", { withTimezone: true }),
    checksum: text("checksum").notNull(),
    status: text("status").notNull().default("pending"),
    exported_at: timestamp("exported_at", { withTimezone: true }),
    verified_at: timestamp("verified_at", { withTimezone: true }),
    drop_eligible_at: timestamp("drop_eligible_at", { withTimezone: true }),
    dropped_at: timestamp("dropped_at", { withTimezone: true }),
    last_error: text("last_error"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueEntityPartition: unique().on(table.entity, table.partition_month),
  }),
);
