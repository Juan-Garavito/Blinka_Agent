/**
 * Reporte de gasto de IA (solo lectura, desde ai_usage_logs): total, por modelo/estado y por factura.
 * Coste ESTIMADO con los precios configurados al registrar cada llamada (la API de Gemini no expone la factura real).
 * Uso: npm run ai:cost -w @blinka/backend            (base local)
 *      npm run ai:cost:supabase -w @blinka/backend   (Supabase)
 *      ... -- --since=2026-10-18                      (desde una fecha)
 */
import pg from "pg";
import { getEnv } from "../config/env.js";
import { buildSslOptions } from "../shared/db/client.js";
import { describeDbTarget } from "../shared/db/target.js";

const env = getEnv();
const since = process.argv.find((a) => a.startsWith("--since="))?.split("=")[1] ?? "1970-01-01";
if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error("--since debe ser YYYY-MM-DD");
const url = env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL;
const client = new pg.Client({ connectionString: url, ssl: buildSslOptions(env) });
await client.connect();
try {
  await client.query("BEGIN READ ONLY");
  const byModel = await client.query(
    `select provider, model, is_simulated as simulated, status, count(*)::int as calls,
            sum(input_tokens)::int as input_tokens, sum(output_tokens)::int as output_tokens_incl_thinking,
            sum(estimated_cost_usd)::numeric(14,6)::text as cost_usd
       from ai_usage_logs where created_at >= $1::date group by 1,2,3,4 order by 1,2,4`,
    [since],
  );
  const total = await client.query(
    `select count(*)::int as calls, coalesce(sum(estimated_cost_usd),0)::numeric(14,6)::text as cost_usd,
            count(distinct evaluation_run_id)::int as runs,
            coalesce(sum(estimated_cost_usd) / nullif(count(distinct evaluation_run_id), 0), 0)::numeric(14,6)::text as per_run
       from ai_usage_logs where created_at >= $1::date and not is_simulated`,
    [since],
  );
  const byInvoice = await client.query(
    `select v.invoice_id as invoice_id, coalesce(max(v.supplier_invoice_number), '(sin número)') as invoice,
            string_agg(distinct r.visible_outcome, ', ') as outcome, count(distinct r.id)::int as runs,
            count(*)::int as calls, sum(u.estimated_cost_usd)::numeric(14,6)::text as cost_usd
       from ai_usage_logs u
       join evaluation_runs r on r.id = u.evaluation_run_id
       join invoice_versions v on v.id = r.invoice_version_id
      where u.created_at >= $1::date and not u.is_simulated
      group by v.invoice_id order by sum(u.estimated_cost_usd) desc`,
    [since],
  );
  await client.query("ROLLBACK");
  const t = total.rows[0] as { calls: number; cost_usd: string; runs: number; per_run: string };
  const perRun = t.per_run;
  process.stdout.write(
    JSON.stringify(
      { database: describeDbTarget(url), since, realAi: { calls: t.calls, analyses: t.runs, estimatedCostUsd: t.cost_usd, averagePerAnalysisUsd: perRun }, byModelAndStatus: byModel.rows, byInvoice: byInvoice.rows, note: "Coste estimado de lista; incluye pensamiento como salida. No es la factura real del proveedor." },
      null,
      2,
    ) + "\n",
  );
} finally {
  await client.end();
}
