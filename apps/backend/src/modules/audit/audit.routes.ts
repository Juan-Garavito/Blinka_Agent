import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../shared/db/client.js";
import { ctxOf } from "../../shared/http/context.js";
import { aiUsageLogs } from "../../agents/ai-usage.schema.js";
import { auditEvents } from "./audit.schema.js";

const query = z.object({
  entityType: z.string().regex(/^[a-z_]{2,40}$/).optional(),
  entityRef: z.uuid().optional(),
  eventType: z.string().regex(/^[a-z][a-z0-9_.]{2,80}$/).optional(),
  actorKind: z.enum(["USER", "SYSTEM", "AGENT"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const summaryQuery = z.object({ from: isoDate.optional(), to: isoDate.optional(), top: z.coerce.number().int().min(1).max(100).default(20) });
const usageQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).max(100_000).default(0), evaluationRunId: z.uuid().optional() });

/** Lectura de la auditoría append-only de la empresa (sin secretos: solo metadatos). */
/** Precio de referencia vigente (perfil): se informa junto al resumen; cada fila guarda su coste ya calculado. */
export interface AiPricingInfo {
  provider: string;
  model: string;
  simulated: boolean;
  inputUsdPerMTok: string;
  outputUsdPerMTok: string;
}

export function auditRouter(db: Database, pricing?: AiPricingInfo): Router {
  const router = Router();
  router.get("/audit-events", async (req, res) => {
    const ctx = ctxOf(req);
    const q = query.parse(req.query);
    const events = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.companyId, ctx.companyId),
          q.entityType ? eq(auditEvents.entityType, q.entityType) : undefined,
          q.entityRef ? eq(auditEvents.entityRef, q.entityRef) : undefined,
          q.eventType ? eq(auditEvents.eventType, q.eventType) : undefined,
          q.actorKind ? eq(auditEvents.actorKind, q.actorKind) : undefined,
        ),
      )
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(q.limit)
      .offset(q.offset);
    res.json({ events, limit: q.limit, offset: q.offset });
  });

  /**
   * Totalizado del consumo de IA (coste ESTIMADO con el precio configurado al registrar cada llamada):
   * totales real/simulado, por modelo y estado, por día (zona horaria de la empresa) y por factura.
   * `from`/`to` son fechas locales de la empresa, inclusivas. Sumas en numeric (sin coma flotante).
   */
  router.get("/ai-usage/summary", async (req, res) => {
    const ctx = ctxOf(req);
    const q = summaryQuery.parse(req.query);
    const tz = sql`(select timezone from companies where id = ${ctx.companyId})`;
    const range = sql`u.company_id = ${ctx.companyId}
      ${q.from ? sql`and (u.created_at at time zone ${tz})::date >= ${q.from}::date` : sql``}
      ${q.to ? sql`and (u.created_at at time zone ${tz})::date <= ${q.to}::date` : sql``}`;
    const money = (expr: ReturnType<typeof sql>) => sql`coalesce(${expr}, 0)::numeric(14,8)::text`;
    const { rows: totals } = await db.execute(sql`
      select u.is_simulated as "isSimulated", count(*)::int as calls, count(distinct u.evaluation_run_id)::int as analyses,
             coalesce(sum(u.input_tokens), 0)::int as "inputTokens", coalesce(sum(u.output_tokens), 0)::int as "outputTokens",
             ${money(sql`sum(u.estimated_cost_usd)`)} as "estimatedCostUsd",
             ${money(sql`sum(u.estimated_cost_usd) / nullif(count(distinct u.evaluation_run_id), 0)`)} as "averagePerAnalysisUsd"
        from ai_usage_logs u where ${range} group by 1 order by 1`);
    const { rows: byModel } = await db.execute(sql`
      select u.provider, u.model, u.is_simulated as "isSimulated", u.status, count(*)::int as calls,
             coalesce(sum(u.input_tokens), 0)::int as "inputTokens", coalesce(sum(u.output_tokens), 0)::int as "outputTokens",
             ${money(sql`sum(u.estimated_cost_usd)`)} as "estimatedCostUsd"
        from ai_usage_logs u where ${range} group by 1, 2, 3, 4 order by sum(u.estimated_cost_usd) desc, 1, 2, 4`);
    const { rows: byDay } = await db.execute(sql`
      select to_char((u.created_at at time zone ${tz})::date, 'YYYY-MM-DD') as day, count(*)::int as calls,
             ${money(sql`sum(u.estimated_cost_usd)`)} as "estimatedCostUsd"
        from ai_usage_logs u where ${range} and not u.is_simulated group by 1 order by 1 desc limit 60`);
    const { rows: byStage } = await db.execute(sql`
      select coalesce(sr.stage_code, u.task_type) as stage, count(*)::int as calls,
             count(*) filter (where sr.attempt_no > 1)::int as "retryCalls",
             count(distinct u.evaluation_run_id)::int as analyses,
             ${money(sql`sum(u.estimated_cost_usd)`)} as "estimatedCostUsd",
             ${money(sql`sum(u.estimated_cost_usd) / nullif(count(distinct u.evaluation_run_id), 0)`)} as "averagePerAnalysisUsd"
        from ai_usage_logs u
        left join agent_stage_runs sr on sr.company_id = u.company_id and sr.id = u.stage_run_id
       where ${range} and not u.is_simulated group by 1 order by sum(u.estimated_cost_usd) desc`);
    const { rows: byInvoice } = await db.execute(sql`
      select v.invoice_id as "invoiceId",
             (select iv.supplier_invoice_number from invoices i join invoice_versions iv on iv.id = i.current_version_id where i.id = v.invoice_id) as "supplierInvoiceNumber",
             (select ve.legal_name from invoices i join vendors ve on ve.id = i.vendor_id where i.id = v.invoice_id) as "vendorName",
             count(distinct r.id)::int as analyses, count(*)::int as calls,
             ${money(sql`sum(u.estimated_cost_usd)`)} as "estimatedCostUsd"
        from ai_usage_logs u
        join evaluation_runs r on r.company_id = u.company_id and r.id = u.evaluation_run_id
        join invoice_versions v on v.id = r.invoice_version_id
       where ${range} and not u.is_simulated
       group by v.invoice_id order by sum(u.estimated_cost_usd) desc limit ${q.top}`);
    res.set("Cache-Control", "no-store").json({ from: q.from ?? null, to: q.to ?? null, pricing: pricing ?? null, totals, byModel, byStage, byDay, byInvoice, note: "Coste estimado de lista (incluye pensamiento); no es la factura del proveedor." });
  });

  /** Consumo de IA por llamada (sin prompts ni documentos); `isSimulated` distingue FAKE (MOCK) de real. */
  router.get("/ai-usage", async (req, res) => {
    const ctx = ctxOf(req);
    const q = usageQuery.parse(req.query);
    const usage = await db
      .select()
      .from(aiUsageLogs)
      .where(and(eq(aiUsageLogs.companyId, ctx.companyId), q.evaluationRunId ? eq(aiUsageLogs.evaluationRunId, q.evaluationRunId) : undefined))
      .orderBy(desc(aiUsageLogs.createdAt))
      .limit(q.limit)
      .offset(q.offset);
    res.json({ usage, limit: q.limit, offset: q.offset });
  });
  return router;
}
