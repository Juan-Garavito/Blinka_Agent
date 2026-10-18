import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderInvoiceDocument } from "../../src/modules/demo/invoice-document.js";
import type { DbHandle } from "../../src/shared/db/client.js";
import { apiDocument, apiInvoice, apiInvoiceDocument, financialSetup, hourlyInvoiceData } from "../helpers/commercial.js";
import { PNG_BYTES } from "../helpers/fixtures.js";
import { companySession, makeTestApp, openTestDb, type CompanySession } from "../helpers/identity.js";

describe("Trabajo 1 — verificación de evidencias contra el documento original", () => {
  let db: DbHandle;
  beforeAll(async () => {
    db = await openTestDb();
  });
  afterAll(async () => {
    await db?.close();
  });

  const timesheet = async (c: CompanySession, invoiceId: string) => {
    const ts = await apiDocument(c, "EVIDENCE");
    expect((await c.post(`/api/invoices/${invoiceId}/attachments`, { documentId: ts.id, purpose: "TIMESHEET" })).status).toBe(201);
  };
  const evidenceRows = async (invoiceId: string) =>
    (
      await db.pool.query<{ source_field: string; verification_status: string; page_number: number | null; char_start: number | null; excerpt: string | null }>(
        `select e.source_field, e.verification_status, e.page_number, e.char_start, e.excerpt from evaluation_evidence e
           join evaluation_runs r on r.id = e.evaluation_run_id join evaluation_flows f on f.id = r.flow_id
          where f.invoice_id = $1
            and r.id = (select r2.id from evaluation_runs r2 join evaluation_flows f2 on f2.id = r2.flow_id where f2.invoice_id = $1 and r2.status = 'COMPLETED' order by r2.evaluated_at desc limit 1)
          order by e.source_field`,
        [invoiceId],
      )
    ).rows;

  it("al subir un PDF se guarda su capa de texto (inmutable); una imagen queda sin texto", async () => {
    const c = await companySession(db, makeTestApp(db));
    const pdf = await c.upload("/api/documents?kind=INVOICE", renderInvoiceDocument(hourlyInvoiceData()), "application/pdf", "f.pdf");
    expect(pdf.body.textLayer).toEqual({ status: "TEXT", pageCount: 1, detail: null });
    const img = await c.upload("/api/documents?kind=INVOICE", PNG_BYTES, "image/png", "scan.png");
    expect(img.body.textLayer.status).toBe("NO_TEXT");
    const { rows } = await db.pool.query("select status, extractor, text_sha256 is not null as hashed from document_text_layers where document_id = $1", [pdf.body.document.id]);
    expect(rows).toEqual([{ status: "TEXT", extractor: "unpdf/pdf.js@1.9", hashed: true }]);
    const upd = await db.pool.query("update document_text_pages set text = 'TOTAL A PAGAR: USD 999' where document_id = $1", [pdf.body.document.id]).catch((e: { constraint: string }) => e.constraint);
    expect(upd).toBe("document_text_pages_immutable");
  });

  it("factura conforme: cada valor usado para decidir queda localizado (página, posición, fragmento real)", async () => {
    const c = await companySession(db, makeTestApp(db));
    const s = await financialSetup(c);
    const inv = await apiInvoice(c, { vendorId: s.vendor.id, data: hourlyInvoiceData() });
    await timesheet(c, inv.invoice.id);
    expect((await c.post(`/api/invoices/${inv.invoice.id}/evaluations`, {})).body.evaluation.visibleOutcome).toBe("AUTORIZADA");
    const rows = await evidenceRows(inv.invoice.id);
    expect(rows.length).toBeGreaterThanOrEqual(12);
    expect(rows.every((r) => r.verification_status === "TEXT_VERIFIED" && r.page_number === 1 && r.char_start !== null && r.excerpt)).toBe(true);
    expect(rows.find((r) => r.source_field === "totalAmount")!.excerpt).toBe("TOTAL A PAGAR: USD 1,200.00");
  });

  it("valores inventados respecto del documento → EN_CORRECCION sin reserva (total, número, cuenta, referencia)", async () => {
    const c = await companySession(db, makeTestApp(db));
    const s = await financialSetup(c);
    const real = hourlyInvoiceData();
    const cases: Array<[string, Record<string, unknown>]> = [
      ["EVIDENCE_TOTAL_AMOUNT", { totalAmount: "1300.00", subtotal: "1300.00", lines: [{ concept: "Desarrollo", itemRef: "DEV", quantity: "40", unit: "HOUR", unitPrice: "32.50", subtotal: "1300.00" }] }],
      ["EVIDENCE_SUPPLIER_INVOICE_NUMBER", { supplierInvoiceNumber: "FAC-INVENTADA-1" }],
      ["EVIDENCE_CONTRACT_REF_CITED", { contractRefCited: s.contract.contract.contractRef }],
    ];
    for (const [rule, change] of cases) {
      const docData = { ...real, supplierInvoiceNumber: `${real.supplierInvoiceNumber}-${rule.length}` };
      const doc = await apiInvoiceDocument(c, docData);
      const inv = await apiInvoice(c, { vendorId: s.vendor.id, documentId: doc.id, data: { ...docData, ...change } });
      await timesheet(c, inv.invoice.id);
      const ev = await c.post(`/api/invoices/${inv.invoice.id}/evaluations`, {});
      expect(ev.body.evaluation, rule).toMatchObject({ visibleOutcome: "EN_CORRECCION", reasonCode: rule });
      expect((await db.pool.query("select count(*)::int as n from budget_reservations where invoice_id = $1", [inv.invoice.id])).rows[0].n).toBe(0);
    }
    // Cuenta de destino registrada pero que NO figura en el documento.
    const docData = { ...real, supplierInvoiceNumber: `${real.supplierInvoiceNumber}-ACC`, paymentDestinationRaw: "Consignar en cuenta 1111 2222 3333" };
    const doc = await apiInvoiceDocument(c, docData);
    const inv = await apiInvoice(c, { vendorId: s.vendor.id, documentId: doc.id, data: { ...docData, paymentDestinationRaw: real.paymentDestinationRaw } });
    await timesheet(c, inv.invoice.id);
    expect((await c.post(`/api/invoices/${inv.invoice.id}/evaluations`, {})).body.evaluation.reasonCode).toBe("EVIDENCE_PAYMENT_ACCOUNT");
  });

  it("documento escaneado: UNVERIFIABLE → confirmación humana de la versión actual → autoriza; auditado", async () => {
    const c = await companySession(db, makeTestApp(db));
    const s = await financialSetup(c);
    const scan = await c.upload("/api/documents?kind=INVOICE", PNG_BYTES, "image/png", "scan.png");
    const inv = await apiInvoice(c, { vendorId: s.vendor.id, documentId: scan.body.document.id, data: hourlyInvoiceData() });
    await timesheet(c, inv.invoice.id);
    const ev = await c.post(`/api/invoices/${inv.invoice.id}/evaluations`, {});
    expect(ev.body.evaluation.visibleOutcome).toBe("EN_CORRECCION");
    const pending = (await evidenceRows(inv.invoice.id)).filter((r) => r.verification_status === "UNVERIFIABLE").map((r) => r.source_field);
    expect(pending).toEqual(expect.arrayContaining(["supplierInvoiceNumber", "totalAmount", "currency", "issueDate", "paymentAccount"]));

    const url = `/api/invoices/${inv.invoice.id}/versions/${inv.invoice.currentVersionId}/confirmations`;
    expect((await c.post(url, { fields: ["noExiste"], reason: "Revisé el documento escaneado" })).status).toBe(400);
    expect((await c.post(url, { fields: ["totalAmount"], reason: "corto" })).status).toBe(400);
    // Confirmación parcial: aún falta evidencia del resto → no autoriza.
    expect((await c.post(url, { fields: ["totalAmount"], reason: "Revisé la imagen original de la factura" })).status).toBe(201);
    expect((await c.post(`/api/invoices/${inv.invoice.id}/evaluations`, {})).body.evaluation.visibleOutcome).toBe("EN_CORRECCION");
    const conf = await c.post(url, { fields: pending, reason: "Revisé la imagen original de la factura" });
    expect(conf.status).toBe(201);
    expect((await c.post(`/api/invoices/${inv.invoice.id}/evaluations`, {})).body.evaluation.visibleOutcome).toBe("AUTORIZADA");
    expect((await evidenceRows(inv.invoice.id)).filter((r) => r.verification_status === "HUMAN_CONFIRMED").length).toBe(pending.length);
    const { rows } = await db.pool.query("select details from audit_events where entity_ref = $1 and event_type = 'invoice.evidence_confirmed' order by occurred_at", [inv.invoice.id]);
    expect(rows.at(-1).details).toMatchObject({ textLayer: "NO_TEXT", reason: "Revisé la imagen original de la factura" });
  });

  it("no hay override: en un PDF con texto la discrepancia no se confirma; versión no actual tampoco; otra empresa 404", async () => {
    const c = await companySession(db, makeTestApp(db));
    const s = await financialSetup(c);
    const real = hourlyInvoiceData();
    const doc = await apiInvoiceDocument(c, real);
    const inv = await apiInvoice(c, { vendorId: s.vendor.id, documentId: doc.id, data: { ...real, totalAmount: "9999.00" } });
    const url = `/api/invoices/${inv.invoice.id}/versions/${inv.invoice.currentVersionId}/confirmations`;
    const r = await c.post(url, { fields: ["totalAmount"], reason: "Quiero aprobarla de todos modos" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("EVIDENCE_TEXT_AVAILABLE");
    const other = await companySession(db, c.app);
    expect((await other.post(url, { fields: ["totalAmount"], reason: "Intento desde otra empresa" })).status).toBe(404);
    // Una confirmación de una versión anterior no se arrastra a la nueva.
    const scan = await c.upload("/api/documents?kind=INVOICE", PNG_BYTES, "image/png", "scan.png");
    const inv2 = await apiInvoice(c, { vendorId: s.vendor.id, documentId: scan.body.document.id, data: hourlyInvoiceData() });
    const v1 = inv2.invoice.currentVersionId;
    await c.post(`/api/invoices/${inv2.invoice.id}/versions/${v1}/confirmations`, { fields: ["totalAmount"], reason: "Revisé la imagen original" });
    await c.post(`/api/invoices/${inv2.invoice.id}/versions`, { data: hourlyInvoiceData({ totalAmount: "1250.00" }), reason: "otra" });
    expect((await c.post(`/api/invoices/${inv2.invoice.id}/versions/${v1}/confirmations`, { fields: ["currency"], reason: "Revisé la imagen original" })).body.error.code).toBe("VERSION_NOT_CURRENT");
    expect((await request(c.app).post(url).send({})).status).toBe(401);
  });
});
