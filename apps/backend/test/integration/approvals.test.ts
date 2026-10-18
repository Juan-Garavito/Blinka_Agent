import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContractsService } from "../../src/modules/contracts/contracts.service.js";
import type { DbHandle } from "../../src/shared/db/client.js";
import { apiInvoiceDocument, financialSetup, hourlyInvoiceData, hourlyVersion, readyInvoice } from "../helpers/commercial.js";
import { companySession, makeTestApp, openTestDb, type CompanySession } from "../helpers/identity.js";

/** Factura de 6000 USD (200 h × 30): supera el umbral automático (5000) sin superar el tope (20000). */
const bigInvoice = (overrides: Record<string, unknown> = {}) =>
  hourlyInvoiceData({ subtotal: "6000.00", totalAmount: "6000.00", lines: [{ concept: "Desarrollo", itemRef: "DEV", quantity: "200", unit: "HOUR", unitPrice: "30.00", subtotal: "6000.00" }], ...overrides });

describe("B5 — aprobaciones simuladas, rechazo, correcciones y auditoría", () => {
  let db: DbHandle;
  beforeAll(async () => {
    db = await openTestDb();
  });
  afterAll(async () => {
    await db?.close();
  });

  const session = () => companySession(db, makeTestApp(db));
  /** Contrato con tope de horas suficiente para la factura grande. */
  const setup = async (c: CompanySession, opts: Parameters<typeof financialSetup>[1] = {}) => {
    const s = await financialSetup(c, opts);
    await db.pool.query("update contracts set status = 'TERMINATED' where id = $1", [s.contract.contract.id]);
    const ct = await c.post("/api/contracts", { vendorId: s.vendor.id, categoryId: s.category.id, contractRef: `CT-BIG-${Date.now()}`, billingType: "HOURLY", version: hourlyVersion({ quantityCapPerPeriod: "300" }), confirm: true });
    expect(ct.status).toBe(201);
    return s;
  };
  const pending = async (c: CompanySession, invoiceId: string) => {
    const r = await c.get(`/api/invoices/${invoiceId}/approval-requests`);
    return (r.body.approvalRequests as Array<{ request: { id: string; status: string; amountBase: string; personaId: string; invoiceVersionId: string } }>).map((x) => x.request);
  };
  const reservations = async (invoiceId: string) => (await db.pool.query("select count(*)::int as n from budget_reservations where invoice_id = $1", [invoiceId])).rows[0].n as number;

  it("FIN-04/25: EN_APROBACION crea solicitud PENDIENTE (sin reserva); aprobar dispara NUEVA evaluación que autoriza", async () => {
    const c = await session();
    const s = await setup(c);
    const inv = await readyInvoice(c, s.vendor.id, bigInvoice());
    const ev = await c.post(`/api/invoices/${inv.invoice.id}/evaluations`, {});
    expect(ev.body.evaluation).toMatchObject({ visibleOutcome: "EN_APROBACION", reasonCode: "APPROVAL_REQUIRED" });
    expect(await reservations(inv.invoice.id)).toBe(0);
    const [req] = await pending(c, inv.invoice.id);
    expect(req).toMatchObject({ status: "PENDING", amountBase: "6000.0000", personaId: s.persona.id, invoiceVersionId: inv.invoice.currentVersionId });

    const list = await c.get("/api/approval-requests?status=PENDING");
    expect(list.body).toMatchObject({ simulated: true });
    expect(list.body.approvalRequests[0]).toMatchObject({ vendorName: expect.stringContaining("Proveedor ficticio"), supplierInvoiceNumber: expect.any(String) });
    expect(list.body.approvalRequests[0].persona).toMatchObject({ id: s.persona.id, designation: "CFO (simulada)" });

    const res = await c.post(`/api/approval-requests/${req!.id}/resolve`, { decision: "APPROVE", reason: "Servicio necesario (simulado)" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ simulated: true, approval: { status: "APPROVED" }, evaluation: { visibleOutcome: "AUTORIZADA", runNo: 2, flowId: ev.body.evaluation.flowId } });
    expect(await reservations(inv.invoice.id)).toBe(1);

    const { rows } = await db.pool.query("select details from audit_events where entity_ref = $1 and event_type = 'approval.approved'", [req!.id]);
    expect(rows[0].details).toMatchObject({ simulated: true, simulatedApproverPersonaId: s.persona.id, evaluatorUserId: c.user.id });
    // La aprobación pasó por una corrida con el check de aprobación vigente.
    const hist = (await c.get(`/api/invoices/${inv.invoice.id}/evaluations`)).body;
    const lastRun = hist.flows[0].runs.at(-1);
    expect(lastRun.checks.find((x: { ruleCode: string }) => x.ruleCode === "APPROVAL_REQUIRED")).toMatchObject({ outcome: "PASS" });
  });

  it("doble clic: dos resoluciones simultáneas → una válida, la otra 409; una sola reserva", async () => {
    const c = await session();
    const s = await setup(c);
    const inv = await readyInvoice(c, s.vendor.id, bigInvoice());
    await c.post(`/api/invoices/${inv.invoice.id}/evaluations`, {});
    const [req] = await pending(c, inv.invoice.id);
    const results = await Promise.all([1, 2].map(() => c.post(`/api/approval-requests/${req!.id}/resolve`, { decision: "APPROVE", reason: "doble clic" })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe("APPROVAL_ALREADY_RESOLVED");
    expect(await reservations(inv.invoice.id)).toBe(1);
  });

  it("FIN-26: rechazo → RECHAZADA (≠ BLOQUEADA), trámite cerrado, sin reserva y auditado", async () => {
    const c = await session();
    const s = await setup(c);
    const inv = await readyInvoice(c, s.vendor.id, bigInvoice());
    await c.post(`/api/invoices/${inv.invoice.id}/evaluations`, {});
    const [req] = await pending(c, inv.invoice.id);
    const res = await c.post(`/api/approval-requests/${req!.id}/resolve`, { decision: "REJECT", reason: "Fuera de presupuesto anual (simulado)" });
    expect(res.body).toMatchObject({ approval: { status: "REJECTED" }, evaluation: { visibleOutcome: "RECHAZADA" } });
    expect(await reservations(inv.invoice.id)).toBe(0);
    const hist = (await c.get(`/api/invoices/${inv.invoice.id}/evaluations`)).body;
    expect(hist.status).toBe("RECHAZADA");
    expect(hist.flows[0]).toMatchObject({ terminalStatus: "RECHAZADA" });
    expect(hist.flows[0].runs.at(-1)).toMatchObject({ decision: null, visibleOutcome: "RECHAZADA", reasonCode: "APPROVAL_REJECTED" });
    const { rows } = await db.pool.query("select event_type from audit_events where entity_ref = $1", [inv.invoice.id]);
    expect(rows.map((r) => r.event_type)).toContain("invoice.rejected");
    expect((await c.post(`/api/approval-requests/${req!.id}/resolve`, { decision: "APPROVE", reason: "cambio de opinión" })).status).toBe(409);
    // Un nuevo intento abre OTRO trámite enlazado; el rechazado permanece intacto.
    const again = await c.post(`/api/invoices/${inv.invoice.id}/evaluations`, { justification: "Nueva revisión" });
    expect(again.body.evaluation.flowId).not.toBe(hist.flows[0].id);
    const hist2 = (await c.get(`/api/invoices/${inv.invoice.id}/evaluations`)).body;
    expect(hist2.flows[1]).toMatchObject({ previousFlowId: hist.flows[0].id });
    expect(hist2.flows[0]).toMatchObject({ terminalStatus: "RECHAZADA" });
  });

  it("FIN-03: sobre el tope absoluto → BLOQUEADA y NO se crea solicitud: no hay aprobación posible", async () => {
    const c = await session();
    const s = await setup(c, { hardCap: "5500.00", autoLimit: "1000.00" });
    const inv = await readyInvoice(c, s.vendor.id, bigInvoice());
    const ev = await c.post(`/api/invoices/${inv.invoice.id}/evaluations`, {});
    expect(ev.body.evaluation).toMatchObject({ visibleOutcome: "BLOQUEADA", reasonCode: "HARD_INVOICE_CAP" });
    expect(await pending(c, inv.invoice.id)).toHaveLength(0);
  });

  it("cambio entre solicitud y aprobación: la aprobación de la versión anterior no sirve; se pide una nueva", async () => {
    const c = await session();
    const s = await setup(c);
    const inv = await readyInvoice(c, s.vendor.id, bigInvoice());
    await c.post(`/api/invoices/${inv.invoice.id}/evaluations`, {});
    const [req] = await pending(c, inv.invoice.id);
    // El importe sube tras la solicitud (nueva versión de la misma factura).
    const v2 = bigInvoice({ supplierInvoiceNumber: undefined, subtotal: "6300.00", totalAmount: "6300.00", lines: [{ concept: "Desarrollo", itemRef: "DEV", quantity: "210", unit: "HOUR", unitPrice: "30.00", subtotal: "6300.00" }] });
    delete (v2 as Record<string, unknown>).supplierInvoiceNumber;
    const v2data = { ...v2, supplierInvoiceNumber: (inv.versions[0] as unknown as { supplierInvoiceNumber: string }).supplierInvoiceNumber };
    // La corrección aporta el documento corregido que respalda los nuevos importes.
    const doc2 = await apiInvoiceDocument(c, v2data);
    expect((await c.post(`/api/invoices/${inv.invoice.id}/versions`, { documentId: doc2.id, data: v2data, reason: "Horas adicionales" })).status).toBe(201);
    const res = await c.post(`/api/approval-requests/${req!.id}/resolve`, { decision: "APPROVE", reason: "aprobado (versión 1)" });
    expect(res.body.evaluation).toMatchObject({ visibleOutcome: "EN_APROBACION" });
    expect(await reservations(inv.invoice.id)).toBe(0);
    const reqs = await pending(c, inv.invoice.id);
    expect(reqs.map((r) => r.status).sort()).toEqual(["APPROVED", "PENDING"]);
    expect(reqs.find((r) => r.status === "PENDING")).toMatchObject({ amountBase: "6300.0000" });
  });

  it("presupuesto agotado entre solicitud y aprobación → la reevaluación BLOQUEA", async () => {
    const c = await session();
    const s = await setup(c);
    const inv = await readyInvoice(c, s.vendor.id, bigInvoice());
    await c.post(`/api/invoices/${inv.invoice.id}/evaluations`, {});
    const [req] = await pending(c, inv.invoice.id);
    await c.put("/api/budgets", { period: s.period, scope: "CATEGORY", categoryId: s.category.id, limitBase: "5000.00" });
    const res = await c.post(`/api/approval-requests/${req!.id}/resolve`, { decision: "APPROVE", reason: "aprobado" });
    expect(res.body.evaluation).toMatchObject({ visibleOutcome: "BLOQUEADA", reasonCode: "BUDGET_CATEGORY" });
    expect(await reservations(inv.invoice.id)).toBe(0);
  });

  it("EN_CORRECCION: sin solicitud ni override; una nueva versión corregida se reevalúa en el mismo trámite", async () => {
    const c = await session();
    const s = await setup(c);
    const bad = hourlyInvoiceData({ subtotal: "1600.00", totalAmount: "1600.00", lines: [{ concept: "Desarrollo", itemRef: "DEV", quantity: "40", unit: "HOUR", unitPrice: "40.00", subtotal: "1600.00" }] });
    const inv = await readyInvoice(c, s.vendor.id, bad);
    const ev = await c.post(`/api/invoices/${inv.invoice.id}/evaluations`, {});
    expect(ev.body.evaluation).toMatchObject({ visibleOutcome: "EN_CORRECCION", reasonCode: "HOURLY_RATE" });
    expect(await pending(c, inv.invoice.id)).toHaveLength(0);
    const good = hourlyInvoiceData({ supplierInvoiceNumber: bad.supplierInvoiceNumber });
    // 1) "Corregir" los datos SIN documento que los respalde: el original sigue diciendo 40 → no se autoriza.
    expect((await c.post(`/api/invoices/${inv.invoice.id}/versions`, { data: good, reason: "Intento de corregir solo los datos" })).status).toBe(201);
    const ev2 = await c.post(`/api/invoices/${inv.invoice.id}/evaluations`, {});
    expect(ev2.body.evaluation).toMatchObject({ visibleOutcome: "EN_CORRECCION" });
    expect(ev2.body.evaluation.reasonCode).toMatch(/^EVIDENCE_/);
    // 2) Corrección con el documento corregido (nota crédito / factura rectificada) → autoriza en el mismo trámite.
    const doc2 = await apiInvoiceDocument(c, good);
    expect((await c.post(`/api/invoices/${inv.invoice.id}/versions`, { documentId: doc2.id, data: good, reason: "Nota crédito: tarifa corregida a 30" })).status).toBe(201);
    const ev3 = await c.post(`/api/invoices/${inv.invoice.id}/evaluations`, {});
    expect(ev3.body.evaluation).toMatchObject({ visibleOutcome: "AUTORIZADA", flowId: ev.body.evaluation.flowId, runNo: 3 });
    const hist = (await c.get(`/api/invoices/${inv.invoice.id}/evaluations`)).body;
    expect(hist.flows[0].runs.map((r: { visibleOutcome: string }) => r.visibleOutcome)).toEqual(["EN_CORRECCION", "EN_CORRECCION", "AUTORIZADA"]);
  });

  it("FIN-07: proveedor PENDING → EN_APROBACION sin solicitud de importe; habilitarlo y reevaluar avanza", async () => {
    const c = await session();
    const s = await setup(c);
    await c.post(`/api/vendors/${s.vendor.id}/status`, { status: "PENDING", reason: "Revisión documental" });
    const inv = await readyInvoice(c, s.vendor.id);
    const ev = await c.post(`/api/invoices/${inv.invoice.id}/evaluations`, {});
    expect(ev.body.evaluation).toMatchObject({ visibleOutcome: "EN_APROBACION", reasonCode: "VENDOR_STATUS" });
    expect(await pending(c, inv.invoice.id)).toHaveLength(0);
    await c.post(`/api/vendors/${s.vendor.id}/status`, { status: "AUTHORIZED", reason: "Documentación verificada" });
    expect((await c.post(`/api/invoices/${inv.invoice.id}/evaluations`, {})).body.evaluation.visibleOutcome).toBe("AUTORIZADA");
  });

  it("FIN-29: una versión AI_SUGGESTED no es elegible hasta confirmarla una persona; el sistema no puede confirmar", async () => {
    const c = await session();
    const s = await financialSetup(c);
    await db.pool.query("update contracts set status = 'TERMINATED' where id = $1", [s.contract.contract.id]);
    const created = await c.post("/api/contracts", { vendorId: s.vendor.id, categoryId: s.category.id, contractRef: "CT-AI", billingType: "HOURLY", version: hourlyVersion({ effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31" }), confirm: true });
    const contracts = createContractsService(db.db);
    const agent = { companyId: c.company.id, actor: { kind: "AGENT" as const, ref: "contract-extractor" } };
    const suggested = await contracts.addVersion(agent, created.body.contract.id, { version: hourlyVersion(), confirm: true }, "AI_SUGGESTED");
    const draft = suggested.versions[0]!;
    expect(draft).toMatchObject({ origin: "AI_SUGGESTED", status: "DRAFT" });
    const inv = await readyInvoice(c, s.vendor.id);
    expect((await c.post(`/api/invoices/${inv.invoice.id}/evaluations`, {})).body.evaluation.reasonCode).toBe("CONTRACT_FOUND");
    await expect(contracts.confirmVersion(agent, created.body.contract.id, draft.id)).rejects.toMatchObject({ code: "HUMAN_CONFIRMATION_REQUIRED" });
    expect((await c.post(`/api/contracts/${created.body.contract.id}/versions/${draft.id}/confirm`)).status).toBe(200);
    expect((await c.post(`/api/invoices/${inv.invoice.id}/evaluations`, {})).body.evaluation.visibleOutcome).toBe("AUTORIZADA");
  });

  it("aislamiento y validaciones: otra empresa no resuelve; persona inactiva bloquea la resolución; auditoría consultable", async () => {
    const c = await session();
    const s = await setup(c);
    const inv = await readyInvoice(c, s.vendor.id, bigInvoice());
    await c.post(`/api/invoices/${inv.invoice.id}/evaluations`, {});
    const [req] = await pending(c, inv.invoice.id);
    const other = await session();
    expect((await other.post(`/api/approval-requests/${req!.id}/resolve`, { decision: "APPROVE", reason: "ajeno" })).status).toBe(404);
    expect((await c.post(`/api/approval-requests/${req!.id}/resolve`, { decision: "MAYBE", reason: "x" })).status).toBe(400);
    await c.patch(`/api/approval-personas/${s.persona.id}`, { active: false });
    expect((await c.post(`/api/approval-requests/${req!.id}/resolve`, { decision: "APPROVE", reason: "aprobado" })).body.error.code).toBe("PERSONA_INACTIVE");
    const audit = await c.get(`/api/audit-events?entityType=invoice&entityRef=${inv.invoice.id}`);
    expect(audit.body.events.map((e: { eventType: string }) => e.eventType)).toEqual(expect.arrayContaining(["invoice.created", "evaluation.completed"]));
    expect(JSON.stringify(audit.body)).not.toMatch(/password|csrf|token_hash/i);
    expect((await other.get(`/api/audit-events?entityRef=${inv.invoice.id}`)).body.events).toHaveLength(0);
  });
});
