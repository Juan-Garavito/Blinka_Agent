import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companyIdColumn, createdAt, currencyCode, money, quantity, updatedAt } from "../../shared/db/columns.js";
import { contracts } from "../contracts/contracts.schema.js";
import { expenseCategories } from "../company-config/company-config.schema.js";
import { evaluationRuns } from "../evaluations/evaluations.schema.js";
import { fxRateSnapshots } from "../fx/fx.schema.js";
import { companies } from "../identity/identity.schema.js";
import { invoices } from "../invoices/invoices.schema.js";

export const BUDGET_SCOPES = ["GLOBAL", "CATEGORY"] as const;
export type BudgetScope = (typeof BUDGET_SCOPES)[number];

/**
 * Presupuesto mensual en moneda base (ER §G). `reserved_base` es el saldo
 * materializado; el CHECK reserved_base <= limit_base impide sobregirar en la
 * propia BD aunque la lógica fallara.
 */
export const monthlyBudgets = pgTable(
  "monthly_budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyIdColumn(),
    categoryId: uuid("category_id"),
    periodYyyyMm: text("period_yyyy_mm").notNull(),
    scope: text("scope").$type<BudgetScope>().notNull(),
    limitBase: money("limit_base").notNull(),
    reservedBase: money("reserved_base").notNull().default("0"),
    currency: currencyCode("currency").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ name: "monthly_budgets_company_fk", columns: [t.companyId], foreignColumns: [companies.id] }).onDelete("restrict"),
    foreignKey({ name: "monthly_budgets_category_fk", columns: [t.companyId, t.categoryId], foreignColumns: [expenseCategories.companyId, expenseCategories.id] }).onDelete("restrict"),
    unique("monthly_budgets_company_id_key").on(t.companyId, t.id),
    uniqueIndex("monthly_budgets_global_key").on(t.companyId, t.periodYyyyMm).where(sql`${t.scope} = 'GLOBAL'`),
    uniqueIndex("monthly_budgets_category_key").on(t.companyId, t.periodYyyyMm, t.categoryId).where(sql`${t.scope} = 'CATEGORY'`),
    check("monthly_budgets_period_format", sql`${t.periodYyyyMm} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check("monthly_budgets_scope_valid", sql`case ${t.scope} when 'GLOBAL' then ${t.categoryId} is null when 'CATEGORY' then ${t.categoryId} is not null else false end`),
    check("monthly_budgets_amounts_valid", sql`${t.limitBase} >= 0 and ${t.reservedBase} >= 0 and ${t.reservedBase} <= ${t.limitBase}`),
  ],
);

/** Compromiso simulado por factura autorizada (ER §G). UNIQUE(invoice_id): una sola reserva por factura. */
export const budgetReservations = pgTable(
  "budget_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyIdColumn(),
    invoiceId: uuid("invoice_id").notNull(),
    authorizingRunId: uuid("authorizing_run_id").notNull(),
    fxRateSnapshotId: uuid("fx_rate_snapshot_id").references(() => fxRateSnapshots.id, { onDelete: "restrict" }),
    originalAmount: money("original_amount").notNull(),
    originalCurrency: currencyCode("original_currency").notNull(),
    reservedAmountBase: money("reserved_amount_base").notNull(),
    baseCurrency: currencyCode("base_currency").notNull(),
    periodYyyyMm: text("period_yyyy_mm").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "budget_reservations_invoice_fk", columns: [t.companyId, t.invoiceId], foreignColumns: [invoices.companyId, invoices.id] }).onDelete("restrict"),
    foreignKey({ name: "budget_reservations_run_fk", columns: [t.companyId, t.authorizingRunId], foreignColumns: [evaluationRuns.companyId, evaluationRuns.id] }).onDelete("restrict"),
    unique("budget_reservations_invoice_key").on(t.invoiceId),
    unique("budget_reservations_run_key").on(t.authorizingRunId),
    unique("budget_reservations_idempotency_key").on(t.companyId, t.idempotencyKey),
    unique("budget_reservations_company_id_key").on(t.companyId, t.id),
    check("budget_reservations_amounts_positive", sql`${t.originalAmount} > 0 and ${t.reservedAmountBase} > 0`),
    check("budget_reservations_period_format", sql`${t.periodYyyyMm} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  ],
);

/**
 * Efecto de una reserva en un presupuesto (ER §G). Exactamente dos por reserva
 * (GLOBAL y CATEGORY) por el MISMO importe: no son dos gastos. Un trigger
 * diferido lo verifica al confirmar la transacción.
 */
export const budgetReservationAllocations = pgTable(
  "budget_reservation_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyIdColumn(),
    reservationId: uuid("reservation_id").notNull(),
    monthlyBudgetId: uuid("monthly_budget_id").notNull(),
    scope: text("scope").$type<BudgetScope>().notNull(),
    amountBase: money("amount_base").notNull(),
  },
  (t) => [
    foreignKey({ name: "budget_allocations_reservation_fk", columns: [t.companyId, t.reservationId], foreignColumns: [budgetReservations.companyId, budgetReservations.id] }).onDelete("restrict"),
    foreignKey({ name: "budget_allocations_budget_fk", columns: [t.companyId, t.monthlyBudgetId], foreignColumns: [monthlyBudgets.companyId, monthlyBudgets.id] }).onDelete("restrict"),
    unique("budget_allocations_reservation_scope_key").on(t.reservationId, t.scope),
    check("budget_allocations_scope_valid", sql`${t.scope} in ('GLOBAL', 'CATEGORY')`),
    check("budget_allocations_amount_positive", sql`${t.amountBase} > 0`),
  ],
);

/**
 * Consumo contractual de horas por factura AUTORIZADA (adición física al ER).
 * period_key es el período del CONTRATO que contiene el período de prestación
 * del servicio (YYYY-MM | YYYY-Qn | YYYY), no el mes de autorización
 * presupuestaria. Se crea en la misma transacción que la reserva; UNIQUE(invoice_id)
 * impide contar dos veces la misma factura (versiones, reentregas).
 */
export const contractHourConsumptions = pgTable(
  "contract_hour_consumptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyIdColumn(),
    contractId: uuid("contract_id").notNull(),
    periodKey: text("period_key").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    reservationId: uuid("reservation_id").notNull(),
    hours: quantity("hours").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "hour_consumptions_contract_fk", columns: [t.companyId, t.contractId], foreignColumns: [contracts.companyId, contracts.id] }).onDelete("restrict"),
    foreignKey({ name: "hour_consumptions_invoice_fk", columns: [t.companyId, t.invoiceId], foreignColumns: [invoices.companyId, invoices.id] }).onDelete("restrict"),
    foreignKey({ name: "hour_consumptions_reservation_fk", columns: [t.companyId, t.reservationId], foreignColumns: [budgetReservations.companyId, budgetReservations.id] }).onDelete("restrict"),
    unique("hour_consumptions_invoice_key").on(t.invoiceId),
    unique("hour_consumptions_reservation_key").on(t.reservationId),
    index("hour_consumptions_period_idx").on(t.companyId, t.contractId, t.periodKey),
    check("hour_consumptions_hours_positive", sql`${t.hours} > 0`),
    check("hour_consumptions_period_format", sql`${t.periodKey} ~ '^[0-9]{4}(-(0[1-9]|1[0-2])|-Q[1-4])?$'`),
  ],
);
