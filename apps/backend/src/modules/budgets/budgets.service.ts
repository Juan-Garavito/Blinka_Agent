import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../shared/db/client.js";
import { notFound } from "../../shared/errors/app-error.js";
import type { CompanyCtx } from "../../shared/http/context.js";
import { D, moneyString, toMoney4 } from "../../shared/money.js";
import { recordAudit } from "../audit/audit.service.js";
import { expenseCategories } from "../company-config/company-config.schema.js";
import { companies } from "../identity/identity.schema.js";
import { BUDGET_SCOPES, budgetReservationAllocations, budgetReservations, monthlyBudgets } from "./budgets.schema.js";
import { invoices, invoiceVersions } from "../invoices/invoices.schema.js";
import { vendors } from "../vendors/vendors.schema.js";

export const periodString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "período YYYY-MM");

export const budgetUpsertBody = z
  .object({ period: periodString, scope: z.enum(BUDGET_SCOPES), categoryId: z.uuid().optional(), limitBase: moneyString })
  .strict()
  .refine((b) => (b.scope === "GLOBAL") === !b.categoryId, { error: "GLOBAL sin categoryId; CATEGORY con categoryId" });

const view = (b: typeof monthlyBudgets.$inferSelect) => ({ ...b, availableBase: toMoney4(new D(b.limitBase).minus(b.reservedBase)) });

export function createBudgetsService(db: Database) {
  return {
    async list(ctx: CompanyCtx, period: string) {
      const rows = await db
        .select()
        .from(monthlyBudgets)
        .where(and(eq(monthlyBudgets.companyId, ctx.companyId), eq(monthlyBudgets.periodYyyyMm, period)))
        .orderBy(asc(monthlyBudgets.scope), asc(monthlyBudgets.categoryId));
      return rows.map(view);
    },

    /**
     * Reservas SIMULADAS imputadas a un mes (solo lectura). Cada reserva tiene dos
     * asignaciones (global y categoría) por el MISMO importe: es un compromiso, no dos gastos.
     */
    async reservations(ctx: CompanyCtx, period: string) {
      const rows = await db
        .select({
          id: budgetReservations.id,
          invoiceId: budgetReservations.invoiceId,
          supplierInvoiceNumber: invoiceVersions.supplierInvoiceNumber,
          vendorName: vendors.legalName,
          originalAmount: budgetReservations.originalAmount,
          originalCurrency: budgetReservations.originalCurrency,
          reservedAmountBase: budgetReservations.reservedAmountBase,
          baseCurrency: budgetReservations.baseCurrency,
          fxRateSnapshotId: budgetReservations.fxRateSnapshotId,
          period: budgetReservations.periodYyyyMm,
          authorizedAt: budgetReservations.authorizedAt,
        })
        .from(budgetReservations)
        .innerJoin(invoices, eq(invoices.id, budgetReservations.invoiceId))
        .innerJoin(vendors, eq(vendors.id, invoices.vendorId))
        .leftJoin(invoiceVersions, eq(invoiceVersions.id, invoices.currentVersionId))
        .where(and(eq(budgetReservations.companyId, ctx.companyId), eq(budgetReservations.periodYyyyMm, period)))
        .orderBy(asc(budgetReservations.authorizedAt));
      const allocations = rows.length
        ? await db
            .select({ reservationId: budgetReservationAllocations.reservationId, scope: budgetReservationAllocations.scope, monthlyBudgetId: budgetReservationAllocations.monthlyBudgetId, amountBase: budgetReservationAllocations.amountBase })
            .from(budgetReservationAllocations)
            .where(and(eq(budgetReservationAllocations.companyId, ctx.companyId), sql`${budgetReservationAllocations.reservationId} in ${rows.map((r) => r.id)}`))
        : [];
      return rows.map((r) => ({ ...r, simulated: true, allocations: allocations.filter((a) => a.reservationId === r.id) }));
    },

    /**
     * Crea o ajusta el límite de un presupuesto mensual en moneda base. Nunca
     * modifica `reserved_base`; un límite menor que lo reservado lo rechaza la BD.
     */
    async upsert(ctx: CompanyCtx, body: z.infer<typeof budgetUpsertBody>) {
      return db.transaction(async (tx) => {
        const [company] = await tx.select({ base: companies.baseCurrency }).from(companies).where(eq(companies.id, ctx.companyId));
        if (body.categoryId) {
          const [cat] = await tx.select({ id: expenseCategories.id }).from(expenseCategories).where(and(eq(expenseCategories.id, body.categoryId), eq(expenseCategories.companyId, ctx.companyId)));
          if (!cat) throw notFound("Categoría no encontrada");
        }
        const target = body.scope === "GLOBAL" ? [monthlyBudgets.companyId, monthlyBudgets.periodYyyyMm] : [monthlyBudgets.companyId, monthlyBudgets.periodYyyyMm, monthlyBudgets.categoryId];
        const [row] = await tx
          .insert(monthlyBudgets)
          .values({ companyId: ctx.companyId, periodYyyyMm: body.period, scope: body.scope, categoryId: body.categoryId ?? null, limitBase: body.limitBase, currency: company!.base })
          .onConflictDoUpdate({
            target,
            targetWhere: body.scope === "GLOBAL" ? sql`scope = 'GLOBAL'` : sql`scope = 'CATEGORY'`,
            set: { limitBase: body.limitBase },
          })
          .returning();
        await recordAudit(tx, { companyId: ctx.companyId, actor: ctx.actor, eventType: "budget.limit_set", entityType: "monthly_budget", entityRef: row!.id, details: { period: body.period, scope: body.scope, categoryId: body.categoryId ?? null, limitBase: row!.limitBase } });
        return view(row!);
      });
    },
  };
}

export type BudgetsService = ReturnType<typeof createBudgetsService>;
