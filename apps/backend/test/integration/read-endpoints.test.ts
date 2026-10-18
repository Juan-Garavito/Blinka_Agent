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
});
