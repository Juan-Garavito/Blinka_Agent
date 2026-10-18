import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalDocumentStorage } from "../../src/modules/documents/storage.js";
import type { DbHandle } from "../../src/shared/db/client.js";
import { apiBankAccount, apiCategory, apiContract, apiDocument, apiInvoice, apiVendor, hourlyVersion } from "../helpers/commercial.js";
import { PDF_BYTES, PNG_BYTES } from "../helpers/fixtures.js";
import { companySession, makeTestApp, openTestDb, type CompanySession } from "../helpers/identity.js";

async function pgCode(db: DbHandle, sql: string, params: unknown[] = []) {
  try {
    await db.pool.query(sql, params);
    return "OK";
  } catch (err) {
    const e = err as { code?: string; constraint?: string };
    return `${e.code}:${e.constraint ?? ""}`;
  }
}

describe("B2 — dominio comercial, documentos y facturas", () => {
  let db: DbHandle;
  let a: CompanySession;
  let b: CompanySession;
  let storageDir: string;

  beforeAll(async () => {
    db = await openTestDb();
    storageDir = mkdtempSync(path.join(tmpdir(), "blinka-b2-"));
    const app = makeTestApp(db, { storage: new LocalDocumentStorage(storageDir) });
    a = await companySession(db, app);
    b = await companySession(db, app);
  });
  afterAll(async () => {
    await db?.close();
  });

  describe("configuración de empresa", () => {
    it("categorías: código único por empresa (no global) y auditado", async () => {
      const cat = await apiCategory(a, "SOFTWARE");
      expect((await a.post("/api/categories", { code: "software", name: "Dup" })).status).toBe(409);
      // Otra empresa puede usar el mismo código.
      expect((await apiCategory(b, "SOFTWARE")).code).toBe("SOFTWARE");
      const { rows } = await db.pool.query("select event_type, actor_kind from audit_events where entity_ref = $1", [cat.id]);
      expect(rows).toEqual([{ event_type: "category.created", actor_kind: "USER" }]);
    });

    it("personas aprobadoras simuladas", async () => {
      const r = await a.post("/api/approval-personas", { displayName: "Ana Ficticia", designation: "CFO (simulada)" });
      expect(r.status).toBe(201);
      expect(r.body.simulated).toBe(true);
      expect((await a.get("/api/approval-personas")).body.personas).toHaveLength(1);
      expect((await b.get("/api/approval-personas")).body.personas).toHaveLength(0);
    });
  });

  describe("proveedores y cuentas", () => {
    it("el proveedor nace PENDING; el cambio de estado exige motivo y queda auditado", async () => {
      const v = await apiVendor(a, { taxReference: "900.123.456-7" });
      expect(v.status).toBe("PENDING");
      expect((await a.post(`/api/vendors/${v.id}/status`, { status: "AUTHORIZED" })).status).toBe(400);
      const ok = await a.post(`/api/vendors/${v.id}/status`, { status: "BLOCKED", reason: "Sanción ficticia" });
      expect(ok.body.vendor.status).toBe("BLOCKED");
      const { rows } = await db.pool.query("select details from audit_events where entity_ref = $1 and event_type = 'vendor.status_changed'", [v.id]);
      expect(rows[0].details).toEqual({ from: "PENDING", to: "BLOCKED", reason: "Sanción ficticia" });
      const { rows: tax } = await db.pool.query("select tax_reference from vendors where id = $1", [v.id]);
      expect(tax[0].tax_reference).toBe("9001234567");
    });

    it("la cuenta se guarda como huella HMAC + máscara; nunca el número; estado independiente", async () => {
      const v = await apiVendor(a, { authorize: true });
      const acc = await apiBankAccount(a, v.id, "CO12 3456 7890 1234");
      expect(acc).toMatchObject({ accountMask: "****1234", status: "PENDING" });
      expect(acc).not.toHaveProperty("accountFingerprint");
      const { rows } = await db.pool.query("select * from vendor_bank_accounts where id = $1", [acc.id]);
      expect(JSON.stringify(rows)).not.toContain("1234567890");
      expect(rows[0].account_fingerprint).toMatch(/^[0-9a-f]{64}$/);
      // La misma cuenta del mismo proveedor no se duplica (aunque cambie el formato).
      expect((await a.post(`/api/vendors/${v.id}/bank-accounts`, { country: "CO", currency: "USD", accountNumber: "co1234567890-1234" })).status).toBe(409);
    });

    it("aislamiento: un proveedor de otra empresa es 404 y no aparece en listados", async () => {
      const v = await apiVendor(a);
      expect((await b.get(`/api/vendors/${v.id}`)).status).toBe(404);
      expect((await b.post(`/api/vendors/${v.id}/status`, { status: "AUTHORIZED", reason: "intento ajeno" })).status).toBe(404);
      expect((await b.post(`/api/vendors/${v.id}/bank-accounts`, { country: "CO", currency: "USD", accountNumber: "99887766554433" })).status).toBe(404);
      const ids = ((await b.get("/api/vendors")).body.vendors as Array<{ id: string }>).map((x) => x.id);
      expect(ids).not.toContain(v.id);
    });

    it("la BD impide cuentas de un proveedor de otra empresa (FK compuesta)", async () => {
      const v = await apiVendor(a);
      const code = await pgCode(
        db,
        `insert into vendor_bank_accounts (company_id, vendor_id, country, currency, account_fingerprint, account_mask)
         values ($1, $2, 'CO', 'USD', $3, '****0000')`,
        [b.company.id, v.id, "f".repeat(64)],
      );
      expect(code).toBe("23503:vendor_bank_accounts_vendor_fk");
    });
  });

  describe("documentos privados", () => {
    it("sube un PDF: metadatos, SHA-256, archivo privado bajo clave del backend; auditado", async () => {
      const r = await a.upload("/api/documents?kind=INVOICE", PDF_BYTES, "application/pdf", "../../factura abril.pdf");
      expect(r.status).toBe(201);
      expect(r.body.document).toMatchObject({ kind: "INVOICE", mimeType: "application/pdf", originalName: "factura abril.pdf", sizeBytes: PDF_BYTES.length });
      expect(r.body.document).not.toHaveProperty("storageKey");
      const { rows } = await db.pool.query("select storage_key, sha256 from documents where id = $1", [r.body.document.id]);
      expect(rows[0].storage_key).toBe(`companies/${a.company.id}/documents/${r.body.document.id}`);
      expect(readFileSync(path.join(storageDir, rows[0].storage_key)).equals(PDF_BYTES)).toBe(true);
      expect(readdirSync(storageDir)).toEqual(["companies"]);
    });

    it("rechaza tipo no coincidente, formato no admitido, vacío y demasiado grande", async () => {
      expect((await a.upload("/api/documents?kind=INVOICE", PNG_BYTES, "application/pdf")).body.error.code).toBe("FILE_TYPE_MISMATCH");
      expect((await a.upload("/api/documents?kind=INVOICE", Buffer.from("%PDF-falso"), "image/png")).status).toBe(415);
      expect((await a.upload("/api/documents?kind=INVOICE", Buffer.from("<xml/>"), "application/xml")).status).toBe(415);
      expect((await a.upload("/api/documents?kind=INVOICE", Buffer.alloc(0), "application/pdf")).status).toBe(400);
      expect((await a.upload("/api/documents?kind=INVOICE", Buffer.concat([PDF_BYTES, Buffer.alloc(1024 * 1024)]), "application/pdf")).status).toBe(413);
      expect((await a.upload("/api/documents?kind=OTRO", PDF_BYTES, "application/pdf")).status).toBe(400);
    });

    it("descarga solo autenticada y de la propia empresa, como adjunto con CSP sandbox", async () => {
      const d = await apiDocument(a);
      const res = await a.get(`/api/documents/${d.id}/content`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("application/pdf");
      expect(res.headers["content-disposition"]).toMatch(/^attachment;/);
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["content-security-policy"]).toMatch(/sandbox/);
      expect(res.headers["cache-control"]).toBe("private, no-store");
      expect((await b.get(`/api/documents/${d.id}/content`)).status).toBe(404);
      expect((await b.get(`/api/documents/${d.id}`)).status).toBe(404);
      const access = await a.get(`/api/documents/${d.id}/access`);
      expect(access.body).toEqual({ url: `/api/documents/${d.id}/content`, expiresInSeconds: null, authenticated: true });
    });

    it("el mismo contenido se identifica (sameContentAsDocumentId) sin bloquear la subida", async () => {
      const first = await a.upload("/api/documents?kind=EVIDENCE", PNG_BYTES, "image/png");
      const second = await a.upload("/api/documents?kind=EVIDENCE", PNG_BYTES, "image/png");
      expect(second.body.sameContentAsDocumentId).toBe(first.body.document.id);
    });

    it("los documentos son inmutables en la BD", async () => {
      const d = await apiDocument(a);
      expect(await pgCode(db, "update documents set original_name = 'x.pdf' where id = $1", [d.id])).toBe("23001:documents_immutable");
      expect(await pgCode(db, "delete from documents where id = $1", [d.id])).toBe("23001:documents_immutable");
    });
  });

  describe("contratos por modalidad", () => {
    it("HOURLY confirmado por la persona autenticada; ítems y versión inmutables", async () => {
      const v = await apiVendor(a, { authorize: true });
      const cat = await apiCategory(a);
      const c = await apiContract(a, { vendorId: v.id, categoryId: cat.id });
      const ver = c.versions[0]!;
      expect(ver).toMatchObject({ status: "CONFIRMED", origin: "MANUAL", confirmedByUserId: a.user.id, versionNo: 1 });
      expect(ver.items).toHaveLength(1);
      expect(await pgCode(db, "update contract_versions set currency = 'EUR' where id = $1", [ver.id])).toBe("23001:contract_versions_immutable");
      expect(await pgCode(db, "update contract_items set unit_price = 1 where contract_version_id = $1", [ver.id])).toBe("23001:contract_items_immutable");
      expect(await pgCode(db, "delete from contract_versions where id = $1", [ver.id])).toBe("23001:contract_versions_immutable");
    });

    it("valida campos por modalidad", async () => {
      const v = await apiVendor(a);
      const cat = await apiCategory(a);
      const base = { vendorId: v.id, categoryId: cat.id, contractRef: `X-${randomUUID().slice(0, 6)}` };
      const post = (billingType: string, version: object) => a.post("/api/contracts", { ...base, billingType, version });
      expect((await post("HOURLY", hourlyVersion({ items: [] }))).status).toBe(400);
      expect((await post("RECURRING", { currency: "USD", effectiveFrom: "2026-01-01", billingFrequency: "MONTHLY" })).status).toBe(400);
      expect((await post("MILESTONE", { currency: "USD", effectiveFrom: "2026-01-01", items: [{ kind: "MILESTONE", code: "M1", description: "x", agreedAmount: "100" }] })).status).toBe(400);
      expect((await post("PURCHASE_ORDER", { currency: "USD", effectiveFrom: "2026-01-01", items: [{ kind: "PO_LINE", code: "L1", description: "x", unitPrice: "1" }] })).status).toBe(400);
      expect((await post("HOURLY", hourlyVersion({ effectiveTo: "2025-01-01" }))).status).toBe(400);
      expect((await post("HOURLY", hourlyVersion({ items: [{ kind: "HOURLY_RATE", code: "D", description: "x", unitPrice: 30 }] }))).status).toBe(400);
      const ok = await post("RECURRING", { currency: "USD", effectiveFrom: "2026-01-01", billingFrequency: "MONTHLY", fixedPeriodAmount: "1500.00" });
      expect(ok.status).toBe(201);
    });

    it("la API no permite crear versiones como AI_SUGGESTED ni con campos ajenos", async () => {
      const v = await apiVendor(a);
      const cat = await apiCategory(a);
      const r = await a.post("/api/contracts", { vendorId: v.id, categoryId: cat.id, contractRef: "Z1", billingType: "HOURLY", version: hourlyVersion(), origin: "AI_SUGGESTED" });
      expect(r.status).toBe(400);
    });

    it("no se solapan vigencias confirmadas; borrador → confirmar/rechazar", async () => {
      const v = await apiVendor(a);
      const cat = await apiCategory(a);
      const c = await apiContract(a, { vendorId: v.id, categoryId: cat.id });
      const overlap = await a.post(`/api/contracts/${c.contract.id}/versions`, { version: hourlyVersion({ effectiveFrom: "2026-06-01" }), confirm: true });
      expect(overlap.status).toBe(409);
      expect(overlap.body.error.details.constraint).toBe("contract_versions_no_overlap");

      const draft = await a.post(`/api/contracts/${c.contract.id}/versions`, { version: hourlyVersion({ effectiveFrom: "2027-01-01", effectiveTo: "2027-12-31" }) });
      expect(draft.status).toBe(201);
      const d = draft.body.versions[0];
      expect(d).toMatchObject({ versionNo: 2, status: "DRAFT", confirmedByUserId: null });
      const conf = await a.post(`/api/contracts/${c.contract.id}/versions/${d.id}/confirm`);
      expect(conf.body.versions[0].status).toBe("CONFIRMED");
      expect((await a.post(`/api/contracts/${c.contract.id}/versions/${d.id}/confirm`)).status).toBe(409);
      expect((await a.post(`/api/contracts/${c.contract.id}/versions/${d.id}/reject`, { reason: "tarde" })).status).toBe(409);
    });

    it("aislamiento: contrato con proveedor/categoría de otra empresa → 404; la BD también lo impide", async () => {
      const vB = await apiVendor(b);
      const catA = await apiCategory(a);
      const r = await a.post("/api/contracts", { vendorId: vB.id, categoryId: catA.id, contractRef: "CROSS", billingType: "HOURLY", version: hourlyVersion() });
      expect(r.status).toBe(404);
      expect(
        await pgCode(db, "insert into contracts (company_id, vendor_id, category_id, contract_ref, billing_type) values ($1, $2, $3, 'X', 'HOURLY')", [
          a.company.id,
          vB.id,
          catA.id,
        ]),
      ).toBe("23503:contracts_vendor_fk");
      const vA = await apiVendor(a);
      const cA = await apiContract(a, { vendorId: vA.id, categoryId: catA.id });
      expect((await b.get(`/api/contracts/${cA.contract.id}`)).status).toBe(404);
    });
  });

  describe("facturas, versiones e identidad", () => {
    it("proveedor obligatorio; documento debe ser INVOICE, propio y no vinculado a otra factura", async () => {
      const v = await apiVendor(a);
      const doc = await apiDocument(a);
      expect((await a.post("/api/invoices", { documentId: doc.id })).status).toBe(400);
      const contractDoc = await apiDocument(a, "CONTRACT");
      expect((await a.post("/api/invoices", { vendorId: v.id, documentId: contractDoc.id })).body.error.code).toBe("INVALID_DOCUMENT_KIND");
      await apiInvoice(a, { vendorId: v.id, documentId: doc.id });
      expect((await a.post("/api/invoices", { vendorId: v.id, documentId: doc.id })).body.error.code).toBe("DOCUMENT_ALREADY_LINKED");
      const docB = await apiDocument(b);
      expect((await a.post("/api/invoices", { vendorId: v.id, documentId: docB.id })).status).toBe(404);
    });

    it("crea versión 1 con líneas; la corrección crea versión 2 y conserva el original (FIN-27)", async () => {
      const v = await apiVendor(a);
      const inv = await apiInvoice(a, {
        vendorId: v.id,
        data: { supplierInvoiceNumber: "FAC-0001", currency: "USD", totalAmount: "1200.00", lines: [{ concept: "Horas", quantity: "40", unit: "HOUR", unitPrice: "30", subtotal: "1200.00" }] },
      });
      expect(inv.invoice.invoiceNumberNormalized).toBe("FAC0001");
      const corr = await a.post(`/api/invoices/${inv.invoice.id}/versions`, { data: { supplierInvoiceNumber: "FAC-0001", currency: "USD", totalAmount: "1150.00", lines: [] }, reason: "Error de extracción" });
      expect(corr.status).toBe(201);
      expect(corr.body.versions.map((x: { versionNo: number }) => x.versionNo)).toEqual([2, 1]);
      expect(corr.body.versions[1]).toMatchObject({ totalAmount: "1200.0000", origin: "UPLOAD" });
      expect(corr.body.versions[1].lines).toHaveLength(1);
      expect(corr.body.invoice.currentVersionId).toBe(corr.body.versions[0].id);
      expect(corr.body.invoice.id).toBe(inv.invoice.id);
      expect(await pgCode(db, "update invoice_versions set total_amount = 1 where invoice_id = $1", [inv.invoice.id])).toBe("23001:invoice_versions_immutable");
      expect(await pgCode(db, "delete from invoice_lines where invoice_version_id = $1", [inv.versions[0]!.id])).toBe("23001:invoice_lines_immutable");
    });

    it("duplicado: mismo proveedor y número normalizado → enlazado como duplicate_of, sin identidad (FIN-02)", async () => {
      const v = await apiVendor(a);
      const first = await apiInvoice(a, { vendorId: v.id, data: { supplierInvoiceNumber: "fac 777" } });
      const dup = await apiInvoice(a, { vendorId: v.id, data: { supplierInvoiceNumber: "FAC-777" } });
      expect(dup.invoice).toMatchObject({ duplicateOfInvoiceId: first.invoice.id, invoiceNumberNormalized: null });
      const { rows } = await db.pool.query("select event_type from audit_events where entity_ref = $1 order by occurred_at", [dup.invoice.id]);
      expect(rows.map((r) => r.event_type)).toContain("invoice.duplicate_detected");
      // Otro proveedor con el mismo número no es duplicado.
      const v2 = await apiVendor(a);
      expect((await apiInvoice(a, { vendorId: v2.id, data: { supplierInvoiceNumber: "FAC-777" } })).invoice.duplicateOfInvoiceId).toBeNull();
      // Otra empresa tampoco.
      const vB = await apiVendor(b);
      expect((await apiInvoice(b, { vendorId: vB.id, data: { supplierInvoiceNumber: "FAC-777" } })).invoice.duplicateOfInvoiceId).toBeNull();
    });

    it("carrera: dos altas simultáneas con el mismo número → exactamente una identidad", async () => {
      const v = await apiVendor(a);
      const docs = await Promise.all([apiDocument(a), apiDocument(a), apiDocument(a)]);
      const results = await Promise.all(docs.map((d) => apiInvoice(a, { vendorId: v.id, documentId: d.id, data: { supplierInvoiceNumber: "RACE-1" } })));
      const owners = results.filter((r) => r.invoice.invoiceNumberNormalized === "RACE1");
      expect(owners).toHaveLength(1);
      expect(results.filter((r) => r.invoice.duplicateOfInvoiceId === owners[0]!.invoice.id)).toHaveLength(2);
    });

    it("emisión legal nueva con otro número = otra factura enlazada por replaces_invoice_id (FIN-28)", async () => {
      const v = await apiVendor(a);
      const old = await apiInvoice(a, { vendorId: v.id, data: { supplierInvoiceNumber: "A-100" } });
      const reissued = await apiInvoice(a, { vendorId: v.id, replacesInvoiceId: old.invoice.id, data: { supplierInvoiceNumber: "A-101" } });
      expect(reissued.invoice.id).not.toBe(old.invoice.id);
      expect(reissued.invoice).toMatchObject({ replacesInvoiceId: old.invoice.id, invoiceNumberNormalized: "A101", duplicateOfInvoiceId: null });
    });

    it("importes solo como strings decimales; nunca números JSON", async () => {
      const v = await apiVendor(a);
      const doc = await apiDocument(a);
      const r = await a.post("/api/invoices", { vendorId: v.id, documentId: doc.id, data: { totalAmount: 1200.5 } });
      expect(r.status).toBe(400);
    });

    it("aislamiento: facturas de otra empresa no se ven ni se corrigen", async () => {
      const v = await apiVendor(a);
      const inv = await apiInvoice(a, { vendorId: v.id });
      expect((await b.get(`/api/invoices/${inv.invoice.id}`)).status).toBe(404);
      expect((await b.post(`/api/invoices/${inv.invoice.id}/versions`, { data: { lines: [] }, reason: "intento" })).status).toBe(404);
      const listB = (await b.get("/api/invoices")).body.invoices as Array<{ id: string }>;
      expect(listB.map((x) => x.id)).not.toContain(inv.invoice.id);
      // La BD impide una versión de la factura A con un documento de B.
      const docB = await apiDocument(b);
      expect(
        await pgCode(db, "insert into invoice_versions (company_id, invoice_id, version_no, origin, source_document_id) values ($1, $2, 99, 'UPLOAD', $3)", [
          a.company.id,
          inv.invoice.id,
          docB.id,
        ]),
      ).toBe("23503:invoice_versions_document_fk");
    });
  });

  it("sin sesión o sin CSRF no se crea nada", async () => {
    const r = await (await import("supertest")).default(a.app).post("/api/vendors").send({ legalName: "X" });
    expect(r.status).toBe(401);
    const noCsrf = await (await import("supertest")).default(a.app).post("/api/vendors").set("Cookie", a.session.cookie).send({ legalName: "X" });
    expect(noCsrf.status).toBe(403);
  });
});
