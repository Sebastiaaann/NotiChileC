import { pgTable, text } from "drizzle-orm/pg-core";

export const rubrosChilecompra = pgTable("rubros_chilecompra", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  parent_code: text("parent_code"),
});
