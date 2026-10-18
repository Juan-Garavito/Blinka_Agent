import { char, numeric, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Tipos de columna compartidos. El dinero es siempre NUMERIC y se lee como
 * string (nunca number de JavaScript): ver src/shared/money.ts.
 */
export const money = (name: string) => numeric(name, { precision: 20, scale: 4 });
export const quantity = (name: string) => numeric(name, { precision: 20, scale: 4 });
export const unitPrice = (name: string) => numeric(name, { precision: 20, scale: 6 });
export const currencyCode = (name: string) => char(name, { length: 3 });
export const companyIdColumn = () => uuid("company_id").notNull();

export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
