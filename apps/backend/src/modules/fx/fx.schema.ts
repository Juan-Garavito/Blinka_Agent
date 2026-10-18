import { sql } from "drizzle-orm";
import { boolean, check, date, index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { currencyCode } from "../../shared/db/columns.js";

/**
 * Tasa consultada por el servicio FX del backend (ER §G). Inmutable; nunca la
 * genera un LLM. `is_simulated` marca de forma inequívoca las tasas de fixture.
 * Base = origen → tasa 1 (proveedor IDENTITY).
 */
export const fxRateSnapshots = pgTable(
  "fx_rate_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromCurrency: currencyCode("from_currency").notNull(),
    toCurrency: currencyCode("to_currency").notNull(),
    rate: numeric("rate", { precision: 28, scale: 12 }).notNull(),
    provider: text("provider").notNull(),
    providerReference: text("provider_reference"),
    /** Fecha de publicación de la tasa según el proveedor. */
    rateDate: date("rate_date").notNull(),
    rateTimestamp: timestamp("rate_timestamp", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    isSimulated: boolean("is_simulated").notNull(),
  },
  (t) => [
    index("fx_rate_snapshots_pair_idx").on(t.fromCurrency, t.toCurrency, t.provider, t.fetchedAt),
    check("fx_rate_snapshots_rate_positive", sql`${t.rate} > 0`),
    check("fx_rate_snapshots_currencies_iso", sql`${t.fromCurrency} ~ '^[A-Z]{3}$' and ${t.toCurrency} ~ '^[A-Z]{3}$'`),
    check("fx_rate_snapshots_identity", sql`${t.fromCurrency} <> ${t.toCurrency} or (${t.rate} = 1 and ${t.provider} = 'IDENTITY')`),
    check("fx_rate_snapshots_validity", sql`${t.validUntil} > ${t.rateTimestamp}`),
  ],
);
