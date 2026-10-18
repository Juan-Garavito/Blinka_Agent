import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEvaluationService } from "../../src/modules/evaluations/evaluation.service.js";
import { FixtureFxProvider } from "../../src/modules/fx/fx.providers.js";
import { createFxService } from "../../src/modules/fx/fx.service.js";
import type { DbHandle } from "../../src/shared/db/client.js";
import { silentLogger } from "../helpers/env.js";
import { apiInvoiceDocument, financialSetup, hourlyInvoiceData, readyInvoice } from "../helpers/commercial.js";
import { companySession, makeTestApp, openTestDb, TEST_FX_RATES, type CompanySession } from "../helpers/identity.js";

const SYSTEM = { kind: "SYSTEM" as const, ref: "test" };
/** Factura por horas de `h` horas a 30 USD en el período de servicio indicado. */
const hoursInvoice = (h: number, month = "2026-10") =>
  hourlyInvoiceData({
    supplierInvoiceNumber: `H-${randomUUID().slice(0, 8)}`,
    servicePeriodStart: `${month}-01`,
    servicePeriodEnd: `${month}-28`,
    subtotal: (h * 30).toFixed(2),
    totalAmount: (h * 30).toFixed(2),
    lines: [{ concept: "Desarrollo", itemRef: "DEV", quantity: String(h), unit: "HOUR", unitPrice: "30.00", subtotal: (h * 30).toFixed(2) }],
  });

describe("Trabajo 2 — tope acumulado de horas por período de servicio (PostgreSQL real)", () => {
  let db: DbHandle;
  beforeAll(async () => {
    db = await openTestDb();
  });
  afterAll(async () => {
    await db?.close();
  });

  const service = () =>
    createEvaluationService({
      db: db.db,
      fx: createFxService({ db: db.db, provider: new FixtureFxProvider(TEST_FX_RATES), logger: silentLogger, config: { maxAgeHours: 96, reuseMinutes: 0 } }),
      logger: silentLogger,
      fingerprintSecret: process.env.ACCOUNT_FINGERPRINT_SECRET,
    });
  /** Contrato con tope de 160 h/mes (helper estándar). */
  const setup = async () => {
    const c = await companySession(db, makeTestApp(db));
    const s = await financialSetup(c);
    return { c, s };
  };
  const evaluate = (c: CompanySession, id: string) => c.post(`/api/invoices/${id}/evaluations`, {});
  const consumed = async (contractId: string) =>
    (await db.pool.query<{ period_key: string; hours: string }>("select period_key, sum(hours)::text as hours from contract_hour_consumptions where contract_id = $1 group by 1 order by 1", [contractId])).rows;

  it("acumula entre varias facturas: 100 h + 70 h excede 160 → corrección; 100 h + 60 h cabe exactamente", async () => {
    const { c, s } = await setup();
    const a = await readyInvoice(c, s.vendor.id, hoursInvoice(100));
    expect((await evaluate(c, a.invoice.id)).body.evaluation.visibleOutcome).toBe("AUTORIZADA");
    const b = await readyInvoice(c, s.vendor.id, hoursInvoice(70));
    const rb = await evaluate(c, b.invoice.id);
    expect(rb.body.evaluation).toMatchObject({ visibleOutcome: "EN_CORRECCION", reasonCode: "HOURLY_CAP" });
    const hist = (await c.get(`/api/invoices/${b.invoice.id}/evaluations`)).body;
    expect(hist.flows[0].runs[0].checks.find((x: { ruleCode: string }) => x.ruleCode === "HOURLY_CAP").observedText).toMatch(/^100 previas \+ 70 esta factura = 170 h \(2026-10\)$/);
    const d = await readyInvoice(c, s.vendor.id, hoursInvoice(60));
    expect((await evaluate(c, d.invoice.id)).body.evaluation.visibleOutcome).toBe("AUTORIZADA");
    expect(await consumed(s.contract.contract.id)).toEqual([{ period_key: "2026-10", hours: "160.0000" }]);
    const e = await readyInvoice(c, s.vendor.id, hoursInvoice(1));
    expect((await evaluate(c, e.invoice.id)).body.evaluation.reasonCode).toBe("HOURLY_CAP");
  });

  it("versiones: solo cuentan las horas de la versión autorizada (sin doble conteo)", async () => {
    const { c, s } = await setup();
    const inv = await readyInvoice(c, s.vendor.id, hoursInvoice(200));
    expect((await evaluate(c, inv.invoice.id)).body.evaluation.reasonCode).toBe("HOURLY_CAP");
    const data = { ...hoursInvoice(100), supplierInvoiceNumber: (inv.versions[0] as unknown as { supplierInvoiceNumber: string }).supplierInvoiceNumber };
    const doc = await apiInvoiceDocument(c, data);
    expect((await c.post(`/api/invoices/${inv.invoice.id}/versions`, { documentId: doc.id, data, reason: "Nota crédito: 100 horas" })).status).toBe(201);
    expect((await evaluate(c, inv.invoice.id)).body.evaluation.visibleOutcome).toBe("AUTORIZADA");
    expect(await consumed(s.contract.contract.id)).toEqual([{ period_key: "2026-10", hours: "100.0000" }]);
  });

  it("carrera: dos facturas de 100 h con tope 160 evaluadas a la vez → exactamente una autorizada", async () => {
    const { c, s } = await setup();
    const a = await readyInvoice(c, s.vendor.id, hoursInvoice(100));
    const b = await readyInvoice(c, s.vendor.id, hoursInvoice(100));
    const svc = service();
    const results = await Promise.all([a, b].map((x) => svc.evaluate(c.company.id, x.invoice.id, { trigger: "MANUAL", actor: SYSTEM })));
    expect(results.map((r) => r.visibleOutcome).sort()).toEqual(["AUTORIZADA", "EN_CORRECCION"]);
    expect(results.find((r) => r.visibleOutcome === "EN_CORRECCION")!.reasonCode).toBe("HOURLY_CAP");
    expect(await consumed(s.contract.contract.id)).toEqual([{ period_key: "2026-10", hours: "100.0000" }]);
  });

  it("reintento/reentrega de la misma corrida → un único consumo", async () => {
    const { c, s } = await setup();
    const inv = await readyInvoice(c, s.vendor.id, hoursInvoice(40));
    const svc = service();
    const run = await svc.openRun(c.company.id, inv.invoice.id, { trigger: "MANUAL", actor: SYSTEM });
    const fx = await svc.resolveFx(c.company.id, run.invoiceVersionId);
    await svc.finalize(c.company.id, run.runId, { actor: SYSTEM, fx, detectedBillingType: null });
    await svc.finalize(c.company.id, run.runId, { actor: SYSTEM, fx, detectedBillingType: null });
    expect(await consumed(s.contract.contract.id)).toEqual([{ period_key: "2026-10", hours: "40.0000" }]);
    expect(
      (await db.pool.query("update contract_hour_consumptions set hours = 1 where invoice_id = $1", [inv.invoice.id]).catch((e: { constraint: string }) => e.constraint)),
    ).toBe("contract_hour_consumptions_immutable");
  });

  it("el período de servicio (no el de autorización) determina el bucket de horas", async () => {
    const { c, s } = await setup();
    // 150 h de septiembre ya autorizadas no afectan a octubre.
    const sep = await readyInvoice(c, s.vendor.id, hoursInvoice(150, "2026-09"));
    expect((await evaluate(c, sep.invoice.id)).body.evaluation.visibleOutcome).toBe("AUTORIZADA");
    const oct = await readyInvoice(c, s.vendor.id, hoursInvoice(150, "2026-10"));
    expect((await evaluate(c, oct.invoice.id)).body.evaluation.visibleOutcome).toBe("AUTORIZADA");
    const sep2 = await readyInvoice(c, s.vendor.id, hoursInvoice(20, "2026-09"));
    expect((await evaluate(c, sep2.invoice.id)).body.evaluation.reasonCode).toBe("HOURLY_CAP");
    expect(await consumed(s.contract.contract.id)).toEqual([
      { period_key: "2026-09", hours: "150.0000" },
      { period_key: "2026-10", hours: "150.0000" },
    ]);
    // Ambas se imputaron al MISMO mes presupuestario (el de autorización).
    const { rows } = await db.pool.query("select distinct period_yyyy_mm from budget_reservations where company_id = $1", [c.company.id]);
    expect(rows).toHaveLength(1);
  });
});
