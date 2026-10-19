import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../shared/db/client.js";
import { ctxOf } from "../../shared/http/context.js";
import { D } from "../../shared/money.js";
import { periodOf } from "../evaluations/decision-engine.js";
import { companies } from "../identity/identity.schema.js";

/**
 * Supuestos de ROI: los pone el usuario (no se inventan). Defaults explícitos y visibles en la respuesta.
 * reviewMinutes: minutos de revisión manual de una factura; analystHourlyUsd: coste por hora del analista (USD).
 */
const query = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  reviewMinutes: z.coerce.number().int().min(1).max(240).default(15),
  analystHourlyUsd: z.string().regex(/^\d{1,5}(\.\d{1,2})?$/).default("12.00"),
});

type Metric = { key: string; label: string; value: string | number | null; unit: string; definition: string; denominator?: string; source: string; hypothetical: boolean };

const usd = (v: InstanceType<typeof D>) => v.toDecimalPlaces(6).toFixed(6);

/**
 * Dashboard de negocio y ROI (RF-23, RF-30, unidad económica). Todo por empresa y período LOCAL (mes de la
 * zona horaria de la empresa). Separa: (1) hechos medidos, (2) coste de IA ESTIMADO y (3) ahorro HIPOTÉTICO
 * calculado solo con los supuestos indicados por el usuario. Aritmética decimal (sin coma flotante).
 */
export function businessRouter(db: Database): Router {
  const router = Router();
  router.get("/business-metrics", async (req, res) => {
    const ctx = ctxOf(req);
    const q = query.parse(req.query);
    const [company] = await db.select({ tz: companies.timezone, base: companies.baseCurrency }).from(companies).where(eq(companies.id, ctx.companyId));
    const period = q.period ?? periodOf(new Date(), company!.tz);
    const tz = company!.tz;
    const inPeriod = (col: ReturnType<typeof sql>) => sql`to_char(${col} at time zone ${tz}, 'YYYY-MM') = ${period}`;

    // Última corrida COMPLETADA por factura evaluada en el período (estado vigente de cada factura).
    const { rows: outcomes } = await db.execute<{ outcome: string; n: number; via_human: number; amount_base: string | null }>(sql`
      with latest as (
        select distinct on (f.invoice_id) f.invoice_id, r.visible_outcome, r.amount_base, r.evaluated_at, f.trigger_type
          from evaluation_runs r join evaluation_flows f on f.id = r.flow_id
         where r.company_id = ${ctx.companyId} and r.status = 'COMPLETED'
         order by f.invoice_id, r.evaluated_at desc)
      select visible_outcome as outcome, count(*)::int as n,
             count(*) filter (where trigger_type = 'APPROVAL_RESOLVED')::int as via_human,
             coalesce(sum(amount_base), 0)::text as amount_base
        from latest where ${inPeriod(sql`evaluated_at`)} group by 1`);
    const by = Object.fromEntries(outcomes.map((o) => [o.outcome, o]));
    const count = (k: string) => by[k]?.n ?? 0;
    const analyzed = outcomes.reduce((a, o) => a + o.n, 0);
    const autoAuthorized = count("AUTORIZADA") - (by.AUTORIZADA?.via_human ?? 0);
    const autoResolved = autoAuthorized + count("BLOQUEADA");

    const { rows: received } = await db.execute<{ n: number }>(sql`select count(*)::int as n from invoices where company_id = ${ctx.companyId} and ${inPeriod(sql`created_at`)}`);
    const { rows: reserved } = await db.execute<{ n: number; total: string }>(sql`
      select count(*)::int as n, coalesce(sum(reserved_amount_base), 0)::text as total
        from budget_reservations where company_id = ${ctx.companyId} and period_yyyy_mm = ${period}`);
    const { rows: ai } = await db.execute<{ calls: number; runs: number; cost: string }>(sql`
      select count(*)::int as calls, count(distinct evaluation_run_id)::int as runs, coalesce(sum(estimated_cost_usd), 0)::text as cost
        from ai_usage_logs where company_id = ${ctx.companyId} and not is_simulated and ${inPeriod(sql`created_at`)}`);
    const { rows: pending } = await db.execute<{ n: number }>(sql`select count(*)::int as n from approval_requests where company_id = ${ctx.companyId} and status = 'PENDING'`);

    const aiCost = new D(ai[0]!.cost);
    const hourly = new D(q.analystHourlyUsd);
    const manualCostPerInvoice = hourly.times(q.reviewMinutes).div(60);
    const minutesSaved = autoResolved * q.reviewMinutes;
    const manualCostAvoided = manualCostPerInvoice.times(autoResolved);
    const aiCostPerAnalysis = ai[0]!.runs > 0 ? aiCost.div(ai[0]!.runs) : null;
    const net = manualCostAvoided.minus(aiCost);
    const roi = aiCost.gt(0) ? net.div(aiCost) : null;
    const pct = (n: number, d: number) => (d > 0 ? new D(n).times(100).div(d).toDecimalPlaces(1).toFixed(1) : null);
    const base = company!.base;
    const SRC_RUNS = "evaluation_runs (última corrida completada por factura) + evaluation_flows";

    const metrics: Metric[] = [
      { key: "received", label: "Facturas recibidas", value: received[0]!.n, unit: "facturas", definition: "Facturas registradas en el período.", source: "invoices.created_at", hypothetical: false },
      { key: "analyzed", label: "Facturas con decisión", value: analyzed, unit: "facturas", definition: "Facturas cuya decisión vigente se emitió en el período (cualquier resultado).", source: SRC_RUNS, hypothetical: false },
      { key: "automationRate", label: "Resueltas sin intervención humana", value: pct(autoResolved, analyzed), unit: "%", definition: "Autorizadas por el motor sin aprobación humana + bloqueadas por política.", denominator: "Facturas con decisión en el período", source: SRC_RUNS, hypothetical: false },
      { key: "authorizedVolume", label: "Volumen autorizado (simulado)", value: new D(reserved[0]!.total).toFixed(4), unit: base, definition: `Suma de reservas presupuestarias del período (${reserved[0]!.n} autorizaciones). Simulado: no hay pagos.`, source: "budget_reservations.reserved_amount_base", hypothetical: false },
      { key: "blockedVolume", label: "Importe frenado", value: new D(by.BLOQUEADA?.amount_base ?? "0").toFixed(4), unit: base, definition: "Importe en moneda base de las facturas bloqueadas por política (duplicados, topes, proveedor o presupuesto).", source: SRC_RUNS, hypothetical: false },
      { key: "pendingHuman", label: "Pendientes de una persona", value: pending[0]!.n + count("EN_CORRECCION"), unit: "casos", definition: `Aprobaciones pendientes (${pending[0]!.n}) + facturas en corrección (${count("EN_CORRECCION")}).`, source: "approval_requests + evaluation_runs", hypothetical: false },
      { key: "aiCost", label: "Coste de IA (estimado)", value: usd(aiCost), unit: "USD", definition: `Coste de lista de ${ai[0]!.calls} llamadas a IA real en el período (incluye pensamiento). No es la factura del proveedor.`, source: "ai_usage_logs.estimated_cost_usd", hypothetical: false },
      { key: "aiCostPerAnalysis", label: "Coste de IA por análisis", value: aiCostPerAnalysis ? usd(aiCostPerAnalysis) : null, unit: "USD", definition: "Coste de IA del período dividido entre las corridas que usaron IA real.", denominator: `${ai[0]!.runs} corridas con IA real`, source: "ai_usage_logs", hypothetical: false },
      { key: "timeSaved", label: "Tiempo potencial ahorrado", value: new D(minutesSaved).div(60).toDecimalPlaces(2).toFixed(2), unit: "horas", definition: `Facturas resueltas sin intervención (${autoResolved}) × ${q.reviewMinutes} min de revisión manual supuestos. Las escaladas no cuentan (criterio conservador).`, source: "Supuesto del usuario × métricas medidas", hypothetical: true },
      { key: "manualCostPerInvoice", label: "Coste manual por factura", value: usd(manualCostPerInvoice), unit: "USD", definition: `${q.reviewMinutes} min × ${q.analystHourlyUsd} USD/h (supuestos).`, source: "Supuestos del usuario", hypothetical: true },
      { key: "manualCostAvoided", label: "Coste manual evitado", value: usd(manualCostAvoided), unit: "USD", definition: "Tiempo potencial ahorrado × coste por hora del analista.", source: "Supuestos del usuario × métricas medidas", hypothetical: true },
      { key: "netSavings", label: "Ahorro neto estimado", value: usd(net), unit: "USD", definition: "Coste manual evitado − coste de IA del período. No incluye infraestructura ni el tiempo de las revisiones escaladas.", source: "Cálculo", hypothetical: true },
      { key: "roi", label: "ROI de la IA", value: roi ? roi.toDecimalPlaces(2).toFixed(2) : null, unit: "×", definition: "Ahorro neto ÷ coste de IA. Sin coste de IA en el período no se calcula.", denominator: "Coste de IA del período", source: "Cálculo", hypothetical: true },
    ];

    res.set("Cache-Control", "no-store").json({
      period,
      baseCurrency: base,
      assumptions: { reviewMinutes: q.reviewMinutes, analystHourlyUsd: q.analystHourlyUsd },
      metrics,
      outcomes: Object.fromEntries(outcomes.map((o) => [o.outcome, o.n])),
      simulated: true,
      note: "Hechos medidos, coste de IA estimado (precio de lista) y ahorro hipotético se presentan por separado; el ahorro depende de los supuestos indicados.",
    });
  });
  return router;
}
