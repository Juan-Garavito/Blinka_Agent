import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/shared/db/client.js";
import { apiDocument, apiInvoice, financialSetup, hourlyInvoiceData, readyInvoice } from "../helpers/commercial.js";
import { companySession, makeTestApp, openTestDb, type CompanySession } from "../helpers/identity.js";

describe("Endpoints de solo lectura para el frontend", () => {
  let db: DbHandle;
  let c: CompanySession;
  let other: CompanySession;
  let s: Awaited<ReturnType<typeof financialSetup>>;
  let authorized: string;
  let blocked: string;
  let pending: string;

  beforeAll(async () => {
    db = await openTestDb();
    const app = makeTestApp(db);
    c = await companySession(db, app);
    other = await companySession(db, app);
    s = await financialSetup(c);
    const a = await readyInvoice(c, s.vendor.id, hourlyInvoiceData({ supplierInvoiceNumber: "ALFA-777" }));
    authorized = a.invoice.id;
    await c.post(`/api/invoices/${authorized}/evaluations`, {});
    const dup = await readyInvoice(c, s.vendor.id, hourlyInvoiceData({ supplierInvoiceNumber: "ALFA-777", currency: "USD" }));
    blocked = dup.invoice.id;
    await c.post(`/api/invoices/${blocked}/evaluations`, {});
    pending = (await apiInvoice(c, { vendorId: s.vendor.id })).invoice.id;
  });
  afterAll(async () => {
    await db?.close();
  });

  it("GET /api/invoices filtra en servidor por estado, proveedor, búsqueda y devuelve total", async () => {
    const all = (await c.get("/api/invoices")).body;
    expect(all).toMatchObject({ total: 3, limit: 25, offset: 0 });
    expect((await c.get("/api/invoices?status=AUTORIZADA")).body.invoices.map((i: { id: string }) => i.id)).toEqual([authorized]);
    expect((await c.get("/api/invoices?status=BLOQUEADA")).body.invoices.map((i: { id: string }) => i.id)).toEqual([blocked]);
    expect((await c.get("/api/invoices?status=NOT_EVALUATED")).body.invoices.map((i: { id: string }) => i.id)).toEqual([pending]);
    expect((await c.get("/api/invoices?q=alfa-777")).body.total).toBe(2);
    expect((await c.get(`/api/invoices?vendorId=${s.vendor.id}&limit=1`)).body).toMatchObject({ total: 3, limit: 1 });
    expect((await c.get("/api/invoices?q=%25")).body.total).toBe(0); // comodines escapados
    expect((await c.get("/api/invoices?status=PAGADA")).status).toBe(400);
    expect((await other.get("/api/invoices")).body.total).toBe(0);
  });

  it("GET /api/budgets/reservations: reservas simuladas del mes con dos asignaciones del mismo importe", async () => {
    const r = (await c.get(`/api/budgets/reservations?period=${s.period}`)).body;
    expect(r.simulated).toBe(true);
    expect(r.reservations).toHaveLength(1);
    expect(r.reservations[0]).toMatchObject({ invoiceId: authorized, reservedAmountBase: "1200.0000", supplierInvoiceNumber: "ALFA-777" });
    expect(r.reservations[0].allocations.map((x: { scope: string; amountBase: string }) => `${x.scope}:${x.amountBase}`).sort()).toEqual(["CATEGORY:1200.0000", "GLOBAL:1200.0000"]);
    expect((await other.get(`/api/budgets/reservations?period=${s.period}`)).body.reservations).toHaveLength(0);
  });

  it("GET /api/evaluation-runs/:id/evidence y /api/documents/:id/text: posiciones reales, aisladas por empresa", async () => {
    const hist = (await c.get(`/api/invoices/${authorized}/evaluations`)).body;
    const runId = hist.flows[0].runs[0].id as string;
    const ev = (await c.get(`/api/evaluation-runs/${runId}/evidence`)).body;
    const total = ev.evidence.find((e: { sourceField: string }) => e.sourceField === "totalAmount");
    expect(total).toMatchObject({ verificationStatus: "TEXT_VERIFIED", pageNumber: 1 });
    const detail = (await c.get(`/api/invoices/${authorized}`)).body;
    const docId = detail.versions[0].sourceDocumentId as string;
    const text = (await c.get(`/api/documents/${docId}/text`)).body;
    expect(text.layer.status).toBe("TEXT");
    expect(text.pages[0].text.slice(total.charStart, total.charEnd)).toBe("1,200.00");
    expect((await other.get(`/api/evaluation-runs/${runId}/evidence`)).status).toBe(404);
    expect((await other.get(`/api/documents/${docId}/text`)).status).toBe(404);
    const scan = await apiDocument(c, "EVIDENCE");
    expect((await c.get(`/api/documents/${scan.id}/text`)).body.layer.status).toBe("UNPARSEABLE");
  });

  it("GET /api/system/environment rotula servicios simulados sin secretos", async () => {
    const env = (await c.get("/api/system/environment")).body;
    expect(env).toMatchObject({ ai: { provider: "FAKE (MOCK)", simulated: true }, fx: { simulated: true }, storage: { driver: "local" }, payments: { real: false } });
    expect(JSON.stringify(env)).not.toMatch(/key|secret|password|postgres:/i);
    expect((await (await import("supertest")).default(c.app).get("/api/system/environment")).status).toBe(401);
  });

  it("GET /api/audit-events filtra por tipo y actor con paginación; GET /api/ai-usage aislado por empresa", async () => {
    const created = (await c.get(`/api/audit-events?eventType=invoice.created&limit=2`)).body;
    expect(created.events.length).toBe(2);
    expect(created.events.every((e: { eventType: string }) => e.eventType === "invoice.created")).toBe(true);
    const page2 = (await c.get(`/api/audit-events?eventType=invoice.created&limit=2&offset=2`)).body;
    expect(page2.events.length).toBe(1);
    expect((await c.get("/api/audit-events?actorKind=SYSTEM")).body.events.every((e: { actorKind: string }) => e.actorKind === "SYSTEM")).toBe(true);
    expect((await c.get("/api/ai-usage")).body).toMatchObject({ usage: [], limit: 50 });
  });

  it("GET /api/ai-usage/summary totaliza coste exacto por modelo, etapa, día y factura; aislado por empresa y filtrable por fecha", async () => {
    const { rows } = await db.pool.query<{ id: string }>(
      "select r.id from evaluation_runs r join evaluation_flows f on f.id = r.flow_id where f.invoice_id = $1 limit 1",
      [authorized],
    );
    const runId = rows[0]!.id;
    const insert = (companyId: string, run: string | null, provider: string, cost: string, simulated: boolean) =>
      db.pool.query(
        `insert into ai_usage_logs (company_id, evaluation_run_id, task_type, provider, model, input_tokens, output_tokens, estimated_cost_usd, status, latency_ms, is_simulated)
         values ($1, $2, 'INVOICE_EXTRACTION', $3, $4, 1000, 500, $5, 'SUCCEEDED', 10, $6)`,
        [companyId, run, provider, simulated ? "fake-extractor-v1" : "gemini-4-argon", cost, simulated],
      );
    await insert(c.company.id, runId, "GEMINI", "0.01000000", false);
    await insert(c.company.id, runId, "GEMINI", "0.02000001", false);
    await insert(c.company.id, null, "FAKE (MOCK)", "0", true);
    await insert(other.company.id, null, "GEMINI", "5.00000000", false);

    const sum = (await c.get("/api/ai-usage/summary")).body;
    const real = sum.totals.find((t: { isSimulated: boolean }) => !t.isSimulated);
    expect(real).toMatchObject({ calls: 2, analyses: 1, inputTokens: 2000, outputTokens: 1000, estimatedCostUsd: "0.03000001" });
    expect(sum.totals.find((t: { isSimulated: boolean }) => t.isSimulated)).toMatchObject({ calls: 1, estimatedCostUsd: "0.00000000" });
    expect(sum.byInvoice).toEqual([expect.objectContaining({ invoiceId: authorized, supplierInvoiceNumber: "ALFA-777", analyses: 1, calls: 2, estimatedCostUsd: "0.03000001" })]);
    expect(sum.byStage).toEqual([expect.objectContaining({ stage: "INVOICE_EXTRACTION", calls: 2, estimatedCostUsd: "0.03000001" })]);
    expect(sum.byDay).toHaveLength(1);
    expect(sum.byModel.map((m: { model: string }) => m.model)).toEqual(["gemini-4-argon", "fake-extractor-v1"]);
    expect(sum.pricing).toMatchObject({ simulated: true });
    // Otra empresa no ve estos datos ni los suyos se mezclan.
    expect((await other.get("/api/ai-usage/summary")).body.totals).toEqual([expect.objectContaining({ calls: 1, estimatedCostUsd: "5.00000000" })]);
    // Filtro por fecha (local de la empresa) y validación.
    expect((await c.get("/api/ai-usage/summary?from=2999-01-01")).body.totals).toEqual([]);
    expect((await c.get("/api/ai-usage/summary?from=hoy")).status).toBe(400);
  });

  it("GET /api/business-metrics: dashboard de negocio y ROI con definiciones, supuestos explícitos y aritmética exacta", async () => {
    const m = (body: { metrics: Array<{ key: string; value: unknown; hypothetical: boolean; definition: string; source: string }> }, key: string) => body.metrics.find((x) => x.key === key)!;
    const { rows } = await db.pool.query<{ total: string }>("select coalesce(sum(reserved_amount_base),0)::numeric(18,4)::text as total from budget_reservations where company_id = $1", [c.company.id]);
    const body = (await c.get("/api/business-metrics?reviewMinutes=10&analystHourlyUsd=30")).body;
    expect(body.assumptions).toEqual({ reviewMinutes: 10, analystHourlyUsd: "30" });
    expect(m(body, "received").value).toBe(3);
    expect(m(body, "analyzed").value).toBe(2);
    expect(m(body, "automationRate").value).toBe("100.0"); // 1 autorizada por el motor + 1 bloqueada
    expect(m(body, "authorizedVolume").value).toBe(rows[0]!.total);
    expect(m(body, "aiCost").value).toBe("0.030000");
    expect(m(body, "aiCostPerAnalysis").value).toBe("0.030000");
    // Supuestos: 10 min × 30 USD/h = 5 USD por factura; 2 resueltas → 20 min, 10 USD evitados.
    expect(m(body, "timeSaved").value).toBe("0.33");
    expect(m(body, "manualCostPerInvoice").value).toBe("5.000000");
    expect(m(body, "manualCostAvoided").value).toBe("10.000000");
    expect(m(body, "netSavings").value).toBe("9.970000");
    expect(m(body, "roi").value).toBe("332.33");
    // Hechos medidos vs. ahorro hipotético: separados y documentados.
    expect(m(body, "aiCost").hypothetical).toBe(false);
    expect(["timeSaved", "manualCostAvoided", "netSavings", "roi"].every((k) => m(body, k).hypothetical)).toBe(true);
    expect(body.metrics.every((x: { definition: string; source: string }) => x.definition.length > 10 && x.source.length > 3)).toBe(true);
    // Defaults visibles, aislamiento entre empresas y validación.
    expect((await c.get("/api/business-metrics")).body.assumptions).toEqual({ reviewMinutes: 15, analystHourlyUsd: "12.00" });
    const o = (await other.get("/api/business-metrics")).body;
    expect(m(o, "analyzed").value).toBe(0);
    expect(m(o, "automationRate").value).toBeNull();
    expect(m(o, "aiCost").value).toBe("5.000000");
    expect((await c.get("/api/business-metrics?period=2026-13")).status).toBe(400);
    expect((await c.get("/api/business-metrics?analystHourlyUsd=-1")).status).toBe(400);
  });
});
