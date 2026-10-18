import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Tablas técnicas transversales (no forman parte del ER de negocio).
 * rate_limit_buckets: contador de ventana fija compartido entre instancias.
 */
export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    key: text("key").primaryKey(),
    hits: integer("hits").notNull(),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
  },
  (t) => [check("rate_limit_buckets_hits_non_negative", sql`${t.hits} >= 0`), index("rate_limit_buckets_reset_at_idx").on(t.resetAt)],
);
