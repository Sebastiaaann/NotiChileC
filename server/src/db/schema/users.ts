import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  nombre: text("nombre").notNull(),
  password_hash: text("password_hash").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  email_verified_at: timestamp("email_verified_at", { withTimezone: true }),
  verification_token: text("verification_token"),
  verification_token_expires_at: timestamp("verification_token_expires_at", { withTimezone: true }),
  reset_token: text("reset_token"),
  reset_token_expires_at: timestamp("reset_token_expires_at", { withTimezone: true }),
});
