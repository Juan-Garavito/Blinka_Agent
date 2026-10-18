/* eslint-disable no-console -- script CLI de demo: imprime la tabla de resultados */
/**
 * Ejecuta la demo contra una API LOCAL en marcha (por defecto http://127.0.0.1:4000):
 * login del evaluador, análisis asíncrono de cada factura de demo pendiente y
 * polling hasta el resultado. Solo para entornos locales; usa las credenciales
 * del seed (variables de entorno), nunca credenciales fijas.
 */
const base = process.env.DEMO_API_URL ?? "http://127.0.0.1:4000";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) throw new Error("demo-run solo se ejecuta contra una API local");
const email = process.env.SEED_EVALUATOR_EMAIL;
const password = process.env.SEED_EVALUATOR_PASSWORD;
if (!email || !password) throw new Error("Faltan SEED_EVALUATOR_EMAIL / SEED_EVALUATOR_PASSWORD");

const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
if (!login.ok) throw new Error(`Login fallido: HTTP ${login.status}`);
const cookie = login.headers.getSetCookie()[0]!.split(";")[0]!;
const { csrfToken } = (await login.json()) as { csrfToken: string };
const get = async <T>(p: string) => (await (await fetch(`${base}${p}`, { headers: { cookie } })).json()) as T;
const post = (p: string, body: object = {}) => fetch(`${base}${p}`, { method: "POST", headers: { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" }, body: JSON.stringify(body) });

const { invoices } = await get<{ invoices: Array<{ id: string; vendorName: string; status: string | null; processing: boolean }> }>("/api/invoices?limit=100");
const rows: Array<Record<string, string | null>> = [];
for (const inv of invoices.filter((i) => !i.status && !i.processing).reverse()) {
  const res = await post(`/api/invoices/${inv.id}/analysis`);
  const started = (await res.json()) as { runId: string };
  const t0 = Date.now();
  let r: { terminal: boolean; processing: string; stages: Array<{ stage: string; status: string }>; result: { visibleOutcome: string; reasonCode: string; amountBase: string | null } | null };
  do {
    await new Promise((x) => setTimeout(x, 250));
    r = await get(`/api/evaluation-runs/${started.runId}`);
  } while (!r.terminal && Date.now() - t0 < 60_000);
  rows.push({ vendor: inv.vendorName, outcome: r.result?.visibleOutcome ?? r.processing, reason: r.result?.reasonCode ?? null, amountBase: r.result?.amountBase ?? null, stages: r.stages.map((s) => `${s.stage.split("_")[0]}:${s.status}`).join(" "), ms: String(Date.now() - t0) });
}
console.table(rows);
const dash = await get<Record<string, unknown>>("/api/dashboard");
console.log(JSON.stringify({ invoicesByStatus: dash.invoicesByStatus, pendingApprovals: dash.pendingApprovals, aiUsage: dash.aiUsage }, null, 2));
