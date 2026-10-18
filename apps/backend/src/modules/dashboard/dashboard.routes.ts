import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { aiUsageLogs } from "../../agents/ai-usage.schema.js";
import type { Database } from "../../shared/db/client.js";
import { ctxOf } from "../../shared/http/context.js";
import { D, toMoney4 } from "../../shared/money.js";
import { approvalRequests } from "../approvals/approvals.schema.js";
import { periodOf } from "../evaluations/decision-engine.js";
import { monthlyBudgets } from "../budgets/budgets.schema.js";
import { companies } from "../identity/identity.schema.js";

const query = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() });

/**
 * Agregados para el panel: estado comercial (último resultado por factura),
 * presupuestos del mes, aprobaciones pendientes y consumo de IA. Todo por empresa.
 */
export function dashboardRouter(db: Database): Router {
  const router = Router();
  router.get("/dashboard", async (req, res) => {
    const ctx = ctxOf(req);
    const [company] = await db.select({ tz: companies.timezone, base: companies.baseCurrency }).from(companies).where(eq(companies.id, ctx.companyId));
    const period = query.parse(req.query).period ?? periodOf(new Date(), company!.tz);

    const { rows: byStatus } = await db.execute<{ status: string; n: number }>(sql`
      with latest as (
        select distinct on (f.invoice_id) f.invoice_id, r.visible_outcome
          from evaluation_runs r join evaluation_flows f on f.id = r.flow_id
         where r.company_id = ${ctx.companyId} and r.status = 'COMPLETED'
         order by f.invoice_id, r.evaluated_at desc)
      select coalesce(l.visible_outcome, 'SIN_EVALUAR') as status, count(*)::int as n
        from invoices i left join latest l on l.invoice_id = i.id
       where i.company_id = ${ctx.companyId}
       group by 1`);
    const { rows: processing } = await db.execute<{ n: number }>(sql`select count(*)::int as n from evaluation_runs where company_id = ${ctx.companyId} and status = 'RUNNING'`);
    const budgets = await db.select().from(monthlyBudgets).where(and(eq(monthlyBudgets.companyId, ctx.companyId), eq(monthlyBudgets.periodYyyyMm, period)));
    const [{ pending }] = (await db
      .select({ pending: sql<number>`count(*)::int` })
      .from(approvalRequests)
      .where(and(eq(approvalRequests.companyId, ctx.companyId), eq(approvalRequests.status, "PENDING")))) as [{ pending: number }];
    const ai = await db
      .select({
        provider: aiUsageLogs.provider,
        isSimulated: aiUsageLogs.isSimulated,
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${aiUsageLogs.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${aiUsageLogs.outputTokens}), 0)::int`,
        estimatedCostUsd: sql<string>`coalesce(sum(${aiUsageLogs.estimatedCostUsd}), 0)::text`,
      })
      .from(aiUsageLogs)
      .where(eq(aiUsageLogs.companyId, ctx.companyId))
      .groupBy(aiUsageLogs.provider, aiUsageLogs.isSimulated);

    res.set("Cache-Control", "no-store").json({
      period,
      baseCurrency: company!.base,
      invoicesByStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
      processingRuns: processing[0]?.n ?? 0,
      pendingApprovals: pending,
      budgets: budgets.map((b) => ({ id: b.id, scope: b.scope, categoryId: b.categoryId, limitBase: b.limitBase, reservedBase: b.reservedBase, availableBase: toMoney4(new D(b.limitBase).minus(b.reservedBase)) })),
      aiUsage: ai,
      simulatedAuthorizations: true,
    });
  });
  return router;
}
