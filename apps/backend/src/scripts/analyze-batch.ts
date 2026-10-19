/* eslint-disable no-console -- script CLI: imprime progreso y tabla de resultados */
/**
 * Análisis MASIVO encolado contra una API local en marcha (start:cloud, prod:up o dev:api).
 * Selecciona facturas, las encola por la API (misma ruta que la interfaz: autorización, auditoría, cola)
 * manteniendo como máximo --parallel en curso (la API limita 10 pendientes por empresa y 60/hora),
 * sigue cada corrida hasta su resultado y al final muestra la tabla y el GASTO de IA del lote.
 *
 *   npm run analyze:batch -w @blinka/backend -- [opciones]
 *     --api=http://127.0.0.1:4003   API local (por defecto DEMO_API_URL o :4003)
 *     --select=pending,error        pending (sin evaluar) | error | correction | all (todas, reanaliza)
 *     --parallel=5                  corridas simultáneas en cola (1–10)
 *     --limit=100                   máximo de facturas
 *     --dry-run                     solo lista lo que analizaría
 */
const arg = (name: string, def: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? def;
const base = arg("api", process.env.DEMO_API_URL ?? "http://127.0.0.1:4003").replace(/\/$/, "");
const select = new Set(arg("select", "pending,error").split(","));
const parallel = Math.min(10, Math.max(1, Number(arg("parallel", "5")) || 5));
const limit = Math.max(1, Number(arg("limit", "100")) || 100);
const dryRun = process.argv.includes("--dry-run");
const RUN_TIMEOUT_MS = 6 * 60_000;

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) throw new Error("analyze-batch solo se ejecuta contra una API en este equipo (localhost)");
for (const s of select) if (!["pending", "error", "correction", "all"].includes(s)) throw new Error(`--select desconocido: ${s}`);
const email = process.env.SEED_EVALUATOR_EMAIL;
const password = process.env.SEED_EVALUATOR_PASSWORD;
if (!email || !password) throw new Error("Faltan SEED_EVALUATOR_EMAIL / SEED_EVALUATOR_PASSWORD");
// API HTTPS local (prod:up con Caddy) usa la CA interna de Caddy: confiar solo para localhost.
if (base.startsWith("https://")) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
if (!login.ok) throw new Error(`Login fallido: HTTP ${login.status}`);
const cookie = login.headers.getSetCookie()[0]!.split(";")[0]!;
const { csrfToken } = (await login.json()) as { csrfToken: string };
// Cliente CLI: sin cabecera Origin (como demo-run); la protección CSRF usa cookie + X-CSRF-Token.
const headers = { cookie };
const get = async <T>(p: string): Promise<T> => {
  const r = await fetch(`${base}${p}`, { headers });
  if (!r.ok) throw new Error(`GET ${p}: HTTP ${r.status}`);
  return (await r.json()) as T;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Inv = { id: string; supplierInvoiceNumber: string | null; vendorName: string; status: string | null; processing: boolean };
type Usage = Array<{ provider: string; isSimulated: boolean; calls: number; estimatedCostUsd: string }>;
/** "0.08640800" → unidades de 1e-8 USD (BigInt, sin coma flotante). */
const toUnits = (s: string) => {
  const [int = "0", frac = ""] = String(s).split(".");
  return BigInt(int + frac.padEnd(8, "0").slice(0, 8));
};
const aiTotals = async () => {
  const d = await get<{ aiUsage: Usage }>("/api/dashboard");
  const real = d.aiUsage.filter((u) => !u.isSimulated);
  return { calls: real.reduce((a, u) => a + u.calls, 0), units: real.reduce((a, u) => a + toUnits(u.estimatedCostUsd), 0n) };
};
const fmtUnits = (u: bigint) => `${u / 100_000_000n}.${(u % 100_000_000n).toString().padStart(8, "0")}`;

// Selección (paginada).
const all: Inv[] = [];
for (let offset = 0; ; offset += 100) {
  const page = await get<{ invoices: Inv[]; total: number }>(`/api/invoices?limit=100&offset=${offset}&sort=created_asc`);
  all.push(...page.invoices);
  if (all.length >= page.total || page.invoices.length === 0) break;
}
const chosen = all
  .filter((i) => !i.processing)
  .filter((i) => select.has("all") || (select.has("pending") && !i.status) || (select.has("error") && i.status === "ERROR") || (select.has("correction") && i.status === "EN_CORRECCION"))
  .slice(0, limit);

console.log(`API ${base} · ${all.length} facturas · seleccionadas ${chosen.length} (${[...select].join(",")}) · en paralelo ${parallel}`);
if (dryRun || chosen.length === 0) {
  console.table(chosen.map((i) => ({ factura: i.supplierInvoiceNumber ?? "(sin número)", proveedor: i.vendorName, estado: i.status ?? "sin evaluar" })));
  process.exit(0);
}

const before = await aiTotals();
const t0 = Date.now();
const queue = [...chosen];
const results: Array<Record<string, string>> = [];

async function analyze(inv: Inv) {
  const label = inv.supplierInvoiceNumber ?? inv.id.slice(0, 8);
  let runId: string | undefined;
  for (;;) {
    const r = await fetch(`${base}/api/invoices/${inv.id}/analysis`, {
      method: "POST",
      headers: { ...headers, "x-csrf-token": csrfToken, "content-type": "application/json" },
      body: JSON.stringify(inv.status ? { justification: "Reanálisis en lote (analyze:batch)" } : {}),
    });
    if (r.status === 202) {
      runId = ((await r.json()) as { runId: string }).runId;
      break;
    }
    const body = (await r.json().catch(() => ({}))) as { error?: { code?: string } };
    if (r.status === 429) {
      console.log(`  ⏳ ${label}: ${body.error?.code ?? "429"}; se reintenta en 30 s`);
      await sleep(30_000);
      continue;
    }
    results.push({ factura: label, resultado: `NO ENCOLADA (${body.error?.code ?? r.status})`, motivo: "", segundos: "0" });
    return;
  }
  const start = Date.now();
  let run: { terminal: boolean; processing: string; result: { visibleOutcome: string; reasonCode: string } | null };
  do {
    await sleep(2000);
    run = await get(`/api/evaluation-runs/${runId}`);
  } while (!run.terminal && Date.now() - start < RUN_TIMEOUT_MS);
  const row = { factura: label, resultado: run.result?.visibleOutcome ?? `SIN TERMINAR (${run.processing})`, motivo: run.result?.reasonCode ?? "", segundos: String(Math.round((Date.now() - start) / 1000)) };
  results.push(row);
  console.log(`  ✓ ${label}: ${row.resultado} ${row.motivo} (${row.segundos} s) · ${results.length}/${chosen.length}`);
}

await Promise.all(
  Array.from({ length: Math.min(parallel, queue.length) }, async () => {
    for (let inv = queue.shift(); inv; inv = queue.shift()) await analyze(inv);
  }),
);

const after = await aiTotals();
console.table(results);
const byOutcome: Record<string, number> = {};
for (const r of results) byOutcome[r.resultado ?? "?"] = (byOutcome[r.resultado ?? "?"] ?? 0) + 1;
console.log(JSON.stringify({
  facturas: results.length,
  resultados: byOutcome,
  duracionSegundos: Math.round((Date.now() - t0) / 1000),
  iaReal: { llamadas: after.calls - before.calls, costeEstimadoUsd: fmtUnits(after.units - before.units) },
  nota: "Coste estimado de lista (incluye pensamiento); detalle: npm run ai:cost[:supabase] -w @blinka/backend",
}, null, 2));
