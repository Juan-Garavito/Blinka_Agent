import { expect } from "vitest";
import { randomUUID } from "node:crypto";
import type { CompanySession } from "./identity.js";
import { pdfWith } from "./fixtures.js";
import { renderInvoiceDocument, type InvoiceDocData } from "../../src/modules/demo/invoice-document.js";

/** Sube como INVOICE un PDF ficticio cuyo texto contiene exactamente `data`. */
export async function apiInvoiceDocument(c: CompanySession, data: InvoiceDocData) {
  const r = await c.upload("/api/documents?kind=INVOICE", renderInvoiceDocument(data), "application/pdf", "factura.pdf");
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.document as { id: string; sha256: string };
}

/** Fábricas vía API (mismo camino que usará el frontend). */
export async function apiCategory(c: CompanySession, code = `CAT${randomUUID().slice(0, 6).toUpperCase()}`) {
  const r = await c.post("/api/categories", { code, name: `Categoría ${code}` });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.category as { id: string; code: string };
}

export async function apiVendor(c: CompanySession, opts: { authorize?: boolean; taxReference?: string } = {}) {
  const r = await c.post("/api/vendors", { legalName: `Proveedor ficticio ${randomUUID().slice(0, 6)}`, ...(opts.taxReference ? { taxReference: opts.taxReference } : {}) });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const vendor = r.body.vendor as { id: string; status: string };
  if (opts.authorize) {
    const s = await c.post(`/api/vendors/${vendor.id}/status`, { status: "AUTHORIZED", reason: "Verificado en prueba" });
    expect(s.status).toBe(200);
  }
  return vendor;
}

export async function apiBankAccount(c: CompanySession, vendorId: string, accountNumber: string, opts: { authorize?: boolean; currency?: string } = {}) {
  const r = await c.post(`/api/vendors/${vendorId}/bank-accounts`, { country: "CO", currency: opts.currency ?? "USD", accountNumber });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const account = r.body.bankAccount as { id: string };
  if (opts.authorize) {
    expect((await c.post(`/api/vendors/${vendorId}/bank-accounts/${account.id}/status`, { status: "AUTHORIZED", reason: "Verificada en prueba" })).status).toBe(200);
  }
  return account;
}

export async function apiDocument(c: CompanySession, kind: "INVOICE" | "CONTRACT" | "EVIDENCE" = "INVOICE", text = randomUUID()) {
  const r = await c.upload(`/api/documents?kind=${kind}`, pdfWith(text), "application/pdf", `${kind.toLowerCase()}-${text.slice(0, 8)}.pdf`);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.document as { id: string; sha256: string };
}

export const hourlyVersion = (overrides: Record<string, unknown> = {}) => ({
  currency: "USD",
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  billingFrequency: "MONTHLY",
  quantityCapPerPeriod: "160",
  items: [{ kind: "HOURLY_RATE", code: "DEV", description: "Desarrollo", unitPrice: "30.00" }],
  ...overrides,
});

export async function apiContract(
  c: CompanySession,
  input: { vendorId: string; categoryId: string; billingType?: string; version?: object; confirm?: boolean; contractRef?: string },
) {
  const r = await c.post("/api/contracts", {
    vendorId: input.vendorId,
    categoryId: input.categoryId,
    contractRef: input.contractRef ?? `CT-${randomUUID().slice(0, 8)}`,
    billingType: input.billingType ?? "HOURLY",
    version: input.version ?? hourlyVersion(),
    confirm: input.confirm ?? true,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { contract: { id: string; contractRef: string }; versions: Array<{ id: string; status: string; items: unknown[] }> };
}

export async function apiInvoice(c: CompanySession, input: { vendorId: string; categoryId?: string; documentId?: string; data?: object; replacesInvoiceId?: string }) {
  // Con datos, el documento contiene esos datos (evidencia verificable); sin datos, un PDF sin contenido útil.
  const documentId = input.documentId ?? (input.data ? (await apiInvoiceDocument(c, input.data)).id : (await apiDocument(c)).id);
  const r = await c.post("/api/invoices", { vendorId: input.vendorId, documentId, ...(input.categoryId ? { categoryId: input.categoryId } : {}), ...(input.data ? { data: input.data } : {}), ...(input.replacesInvoiceId ? { replacesInvoiceId: input.replacesInvoiceId } : {}) });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { invoice: { id: string; invoiceNumberNormalized: string | null; duplicateOfInvoiceId: string | null; currentVersionId: string }; versions: Array<{ id: string; versionNo: number; lines: unknown[] }> };
}

export const currentPeriod = (tz = "America/Bogota", at = new Date()) => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" }).formatToParts(at);
  return `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}`;
};

export const ACCOUNT_NUMBER = "CO98 7654 3210 1122";

/** Datos de factura por horas conforme: 40 h × 30 USD, cuenta registrada. */
export const hourlyInvoiceData = (overrides: Record<string, unknown> = {}) => ({
  supplierInvoiceNumber: `FAC-${randomUUID().slice(0, 8)}`,
  issueDate: "2026-10-10",
  servicePeriodStart: "2026-10-01",
  servicePeriodEnd: "2026-10-31",
  currency: "USD",
  subtotal: "1200.00",
  taxes: "0",
  totalAmount: "1200.00",
  paymentDestinationRaw: `Banco Ficticio cta ${ACCOUNT_NUMBER}`,
  lines: [{ concept: "Desarrollo", itemRef: "DEV", quantity: "40", unit: "HOUR", unitPrice: "30.00", subtotal: "1200.00" }],
  ...overrides,
});

/**
 * Escenario financiero autorizable vía API (FIN-01): categoría, persona simulada,
 * proveedor y cuenta AUTORIZADOS, contrato por horas confirmado, política
 * empresarial (auto 5000, tope 20000, matriz (5000,20000]) y presupuestos del mes.
 */
export async function financialSetup(
  c: CompanySession,
  opts: { globalLimit?: string; categoryLimit?: string; period?: string; contractCurrency?: string; autoLimit?: string; hardCap?: string } = {},
) {
  const category = await apiCategory(c);
  const persona = (await c.post("/api/approval-personas", { displayName: "CFO Ficticia", designation: "CFO (simulada)" })).body.persona as { id: string };
  const vendor = await apiVendor(c, { authorize: true });
  const account = await apiBankAccount(c, vendor.id, ACCOUNT_NUMBER, { authorize: true });
  const contract = await apiContract(c, { vendorId: vendor.id, categoryId: category.id, version: hourlyVersion({ currency: opts.contractCurrency ?? "USD" }) });
  const policy = await c.post("/api/policies", {
    scopeLevel: "COMPANY",
    name: "Política global",
    version: {
      autoApprovalLimitBase: opts.autoLimit ?? "5000.00",
      hardInvoiceCapBase: opts.hardCap ?? "20000.00",
      matrix: [{ minAmountExclusive: opts.autoLimit ?? "5000.00", maxAmountInclusive: opts.hardCap ?? "20000.00", personaId: persona.id }],
    },
  });
  expect(policy.status, JSON.stringify(policy.body)).toBe(201);
  const period = opts.period ?? currentPeriod(c.company.timezone);
  const g = await c.put("/api/budgets", { period, scope: "GLOBAL", limitBase: opts.globalLimit ?? "50000.00" });
  expect(g.status, JSON.stringify(g.body)).toBe(200);
  const k = await c.put("/api/budgets", { period, scope: "CATEGORY", categoryId: category.id, limitBase: opts.categoryLimit ?? "10000.00" });
  expect(k.status, JSON.stringify(k.body)).toBe(200);
  return { category, persona, vendor, account, contract, policyId: policy.body.policy.id as string, period, globalBudgetId: g.body.budget.id as string, categoryBudgetId: k.body.budget.id as string };
}

/** Factura + hoja de horas adjunta. */
export async function readyInvoice(c: CompanySession, vendorId: string, data: Record<string, unknown> = hourlyInvoiceData()) {
  const inv = await apiInvoice(c, { vendorId, data });
  const ts = await apiDocument(c, "EVIDENCE");
  const att = await c.post(`/api/invoices/${inv.invoice.id}/attachments`, { documentId: ts.id, purpose: "TIMESHEET" });
  expect(att.status, JSON.stringify(att.body)).toBe(201);
  return inv;
}
