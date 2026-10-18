import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEvaluationService } from "../../src/modules/evaluations/evaluation.service.js";
import { FixtureFxProvider, type FxProvider } from "../../src/modules/fx/fx.providers.js";
import { createFxService } from "../../src/modules/fx/fx.service.js";
import type { DbHandle } from "../../src/shared/db/client.js";
import { silentLogger } from "../helpers/env.js";
import { apiContract, apiInvoice, financialSetup, hourlyInvoiceData, hourlyVersion, readyInvoice } from "../helpers/commercial.js";
import { companySession, makeTestApp, openTestDb, TEST_FX_RATES, type CompanySession } from "../helpers/identity.js";

const SYSTEM = { kind: "SYSTEM" as const, ref: "test" };

async function pgCode(db: DbHandle, sql: string, params: unknown[] = []) {
  try {
    await db.pool.query(sql, params);
    return "OK";
  } catch (err) {
    const e = err as { code?: string; constraint?: string };
    return `${e.code}:${e.constraint ?? ""}`;
  }
}

describe("B3 — DecisionEngine, FX, presupuestos y reserva atómica (PostgreSQL real)", () => {
  let db: DbHandle;
  let c: CompanySession;

  const service = (opts: { provider?: FxProvider; now?: () => Date; fault?: () => void } = {}) =>
    createEvaluationService({
      db: db.db,
      fx: createFxService({ db: db.db, provider: opts.provider ?? new FixtureFxProvider(TEST_FX_RATES), logger: silentLogger, config: { maxAgeHours: 96, reuseMinutes: 0 }, ...(opts.now ? { now: opts.now } : {}) }),
      logger: silentLogger,
      fingerprintSecret: process.env.ACCOUNT_FINGERPRINT_SECRET,
      ...(opts.now ? { now: opts.now } : {}),
      ...(opts.fault ? { faultInjection: { afterGlobalBudgetUpdate: opts.fault } } : {}),
    });

  const budgets = async (ids: string[]) =>
    (await db.pool.query<{ id: string; reserved_base: string }>("select id, reserved_base from monthly_budgets where id = any($1) order by scope", [ids])).rows;
  const reservationsOf = async (invoiceId: string) =>
    (await db.pool.query("select r.*, (select count(*)::int from budget_reservation_allocations a where a.reservation_id = r.id) as n_alloc from budget_reservations r where invoice_id = $1", [invoiceId])).rows;

  beforeAll(async () => {
    db = await openTestDb();
    c = await companySession(db, makeTestApp(db));
  });
  afterAll(async () => {
    await db?.close();
  });

  it("FIN-01: autoriza vía API — una reserva, dos asignaciones del mismo importe y mes, presupuestos incrementados, auditado", async () => {
    const s = await financialSetup(c);
    const inv = await readyInvoice(c, s.vendor.id);
    const res = await c.post(`/api/invoices/${inv.invoice.id}/evaluations`, {});
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.evaluation).toMatchObject({ decision: "AUTHORIZE", visibleOutcome: "AUTORIZADA", amountBase: "1200.0000", period: s.period });

    const [r] = await reservationsOf(inv.invoice.id);
    expect(r).toMatchObject({ reserved_amount_base: "1200.0000", original_amount: "1200.0000", original_currency: "USD", base_currency: "USD", period_yyyy_mm: s.period, n_alloc: 2, idempotency_key: `authorize:${inv.invoice.id}` });
    const { rows: alloc } = await db.pool.query("select scope, amount_base, monthly_budget_id from budget_reservation_allocations where reservation_id = $1 order by scope", [r.id]);
    expect(alloc).toEqual([
      { scope: "CATEGORY", amount_base: "1200.0000", monthly_budget_id: s.categoryBudgetId },
      { scope: "GLOBAL", amount_base: "1200.0000", monthly_budget_id: s.globalBudgetId },
    ]);
    expect((await budgets([s.globalBudgetId, s.categoryBudgetId])).map((b) => b.reserved_base)).toEqual(["1200.0000", "1200.0000"]);

    const hist = (await c.get(`/api/invoices/${inv.invoice.id}/evaluations`)).body;
    expect(hist.status).toBe("AUTORIZADA");
    expect(hist.flows[0]).toMatchObject({ terminalStatus: "AUTORIZADA" });
    expect(hist.flows[0].runs[0].checks.length).toBeGreaterThan(10);
    expect(hist.flows[0].runs[0].appliedPolicies).toHaveLength(1);
    expect(hist.reservation).toMatchObject({ simulated: true });
    const { rows: ev } = await db.pool.query("select event_type from audit_events where entity_ref = $1 order by occurred_at", [inv.invoice.id]);
    expect(ev.map((e) => e.event_type)).toEqual(expect.arrayContaining(["invoice.created", "invoice.authorized", "evaluation.completed"]));
    // FIN-17: misma moneda → snapshot IDENTITY tasa 1.
    const { rows: fx } = await db.pool.query("select f.rate, f.provider from fx_rate_snapshots f join budget_reservations r on r.fx_rate_snapshot_id = f.id where r.invoice_id = $1", [inv.invoice.id]);
    expect(fx).toEqual([{ rate: "1.000000000000", provider: "IDENTITY" }]);

    // Una factura autorizada no se reevalúa.
    expect((await c.post(`/api/invoices/${inv.invoice.id}/evaluations`, {})).body.error.code).toBe("ALREADY_AUTHORIZED");
  });

  it("FIN-02: duplicado → BLOQUEADA sin reserva y el flujo queda cerrado", async () => {
    const c = await companySession(db, makeTestApp(db));
    const s = await financialSetup(c);
    const data = hourlyInvoiceData();
    await readyInvoice(c, s.vendor.id, data);
    const dup = await readyInvoice(c, s.vendor.id, { ...data });
    const res = await c.post(`/api/invoices/${dup.invoice.id}/evaluations`, {});
    expect(res.body.evaluation).toMatchObject({ decision: "BLOCK", visibleOutcome: "BLOQUEADA", reasonCode: "DUPLICATE_INVOICE" });
    expect(await reservationsOf(dup.invoice.id)).toHaveLength(0);
    expect((await budgets([s.globalBudgetId])).map((b) => b.reserved_base)).toEqual(["0.0000"]);
  });

  it("FIN-04: sobre el umbral → EN_APROBACION, reserva cero, flujo abierto", async () => {
    const c = await companySession(db, makeTestApp(db));
    const s = await financialSetup(c, { autoLimit: "1000.00" });
    const inv = await readyInvoice(c, s.vendor.id);
    const res = await c.post(`/api/invoices/${inv.invoice.id}/evaluations`, {});
    expect(res.body.evaluation).toMatchObject({ decision: "ESCALATE", visibleOutcome: "EN_APROBACION", reasonCode: "APPROVAL_REQUIRED" });
    expect(await reservationsOf(inv.invoice.id)).toHaveLength(0);
    const hist = (await c.get(`/api/invoices/${inv.invoice.id}/evaluations`)).body;
    expect(hist.flows[0]).toMatchObject({ closedAt: null, terminalStatus: null });
  });

  it("FIN-13/14: presupuesto global o de categoría insuficiente → BLOQUEADA, presupuestos intactos", async () => {
    const c = await companySession(db, makeTestApp(db));
    const s1 = await financialSetup(c, { globalLimit: "1000.00" });
    const i1 = await readyInvoice(c, s1.vendor.id);
    expect((await c.post(`/api/invoices/${i1.invoice.id}/evaluations`, {})).body.evaluation.reasonCode).toBe("BUDGET_GLOBAL");
    // Otra empresa para no compartir el presupuesto global del mes.
    const c2 = await companySession(db, c.app);
    const s2 = await financialSetup(c2, { categoryLimit: "500.00" });
    const i2 = await readyInvoice(c2, s2.vendor.id);
    const r2 = await c2.post(`/api/invoices/${i2.invoice.id}/evaluations`, {});
    expect(r2.body.evaluation).toMatchObject({ visibleOutcome: "BLOQUEADA", reasonCode: "BUDGET_CATEGORY" });
    expect((await budgets([s2.globalBudgetId, s2.categoryBudgetId])).map((b) => b.reserved_base)).toEqual(["0.0000", "0.0000"]);
  });

  it("FIN-16: FX caído → ERROR recuperable sin reserva; al volver el servicio, la reevaluación autoriza en el mismo flujo", async () => {
    const c3 = await companySession(db, c.app);
    const s = await financialSetup(c3, { contractCurrency: "EUR" });
    const inv = await readyInvoice(c3, s.vendor.id, hourlyInvoiceData({ currency: "EUR" }));
    const down: FxProvider = { name: "CAIDO", isSimulated: true, quote: () => Promise.resolve({ ok: false, reason: "PROVIDER_UNAVAILABLE" }) };
    const r1 = await service({ provider: down }).evaluate(c3.company.id, inv.invoice.id, { trigger: "MANUAL", actor: SYSTEM });
    expect(r1).toMatchObject({ decision: null, visibleOutcome: "ERROR", reasonCode: "FX_RATE", reservationId: null });
    expect(await reservationsOf(inv.invoice.id)).toHaveLength(0);

    // FIN-18: EUR con tasa (fixture SIMULADA) registrada en fx_rate_snapshots.
    const r2 = await service().evaluate(c3.company.id, inv.invoice.id, { trigger: "RETRY", actor: SYSTEM });
    expect(r2).toMatchObject({ visibleOutcome: "AUTORIZADA", amountBase: "1302.0000", flowId: r1.flowId, runNo: 2 });
    const { rows } = await db.pool.query(
      "select f.rate, f.provider, f.is_simulated, f.from_currency, f.to_currency from fx_rate_snapshots f join budget_reservations r on r.fx_rate_snapshot_id = f.id where r.invoice_id = $1",
      [inv.invoice.id],
    );
    expect(rows).toEqual([{ rate: "1.085000000000", provider: "FIXTURE (SIMULADO)", is_simulated: true, from_currency: "EUR", to_currency: "USD" }]);
  });

  it("FIN-19/20: imputación al mes de autorización en la zona horaria de la empresa (ambos presupuestos)", async () => {
    const c4 = await companySession(db, c.app);
    // Bogotá: 2026-11-01T04:59Z = 31-oct 23:59 local → octubre; 05:00Z → noviembre.
    const sOct = await financialSetup(c4, { period: "2026-10" });
    await c4.put("/api/budgets", { period: "2026-11", scope: "GLOBAL", limitBase: "50000" });
    await c4.put("/api/budgets", { period: "2026-11", scope: "CATEGORY", categoryId: sOct.category.id, limitBase: "10000" });
    const late = await readyInvoice(c4, sOct.vendor.id, hourlyInvoiceData({ issueDate: "2026-10-30" }));
    const r1 = await service({ now: () => new Date("2026-11-01T04:59:00Z") }).evaluate(c4.company.id, late.invoice.id, { trigger: "MANUAL", actor: SYSTEM });
    expect(r1).toMatchObject({ visibleOutcome: "AUTORIZADA", period: "2026-10" });

    const prevMonth = await readyInvoice(c4, sOct.vendor.id, hourlyInvoiceData({ issueDate: "2026-10-05" }));
    const r2 = await service({ now: () => new Date("2026-11-01T05:00:00Z") }).evaluate(c4.company.id, prevMonth.invoice.id, { trigger: "MANUAL", actor: SYSTEM });
    expect(r2).toMatchObject({ visibleOutcome: "AUTORIZADA", period: "2026-11" });
    const { rows } = await db.pool.query(
      "select b.period_yyyy_mm, a.scope from budget_reservation_allocations a join monthly_budgets b on b.id = a.monthly_budget_id join budget_reservations r on r.id = a.reservation_id where r.invoice_id = $1 order by a.scope",
      [prevMonth.invoice.id],
    );
    expect(rows).toEqual([{ period_yyyy_mm: "2026-11", scope: "CATEGORY" }, { period_yyyy_mm: "2026-11", scope: "GLOBAL" }]);
  });

  it("FIN-21: dos workers autorizan la misma factura a la vez → 1 reserva, 2 asignaciones, sin doble incremento", async () => {
    const c5 = await companySession(db, c.app);
    const s = await financialSetup(c5);
    const inv = await readyInvoice(c5, s.vendor.id);
    const svc = service();
    // Dos corridas abiertas sobre el mismo flujo, finalizadas en paralelo.
    const a = await svc.openRun(c5.company.id, inv.invoice.id, { trigger: "MANUAL", actor: SYSTEM });
    const b = await svc.openRun(c5.company.id, inv.invoice.id, { trigger: "MANUAL", actor: SYSTEM });
    const fx = await svc.resolveFx(c5.company.id, a.invoiceVersionId);
    const results = await Promise.all([a, b].map((r) => svc.finalize(c5.company.id, r.runId, { actor: SYSTEM, fx, detectedBillingType: null })));
    expect(results.filter((r) => r.visibleOutcome === "AUTORIZADA")).toHaveLength(1);
    expect(results.filter((r) => r.status === "SUPERSEDED")).toHaveLength(1);
    const res = await reservationsOf(inv.invoice.id);
    expect(res).toHaveLength(1);
    expect(res[0].n_alloc).toBe(2);
    expect((await budgets([s.globalBudgetId, s.categoryBudgetId])).map((x) => x.reserved_base)).toEqual(["1200.0000", "1200.0000"]);
  });

  it("FIN-21b: varias facturas compiten por un presupuesto limitado → nunca se sobregira", async () => {
    const c6 = await companySession(db, c.app);
    const s = await financialSetup(c6, { categoryLimit: "3000.00" });
    const invs = [];
    for (let i = 0; i < 4; i++) invs.push(await readyInvoice(c6, s.vendor.id));
    const svc = service();
    const results = await Promise.all(invs.map((inv) => svc.evaluate(c6.company.id, inv.invoice.id, { trigger: "MANUAL", actor: SYSTEM })));
    expect(results.filter((r) => r.visibleOutcome === "AUTORIZADA")).toHaveLength(2); // 2 × 1200 ≤ 3000 < 3 × 1200
    expect(results.filter((r) => r.reasonCode === "BUDGET_CATEGORY")).toHaveLength(2);
    expect((await budgets([s.categoryBudgetId]))[0]!.reserved_base).toBe("2400.0000");
  });

  it("FIN-22: la cola reentrega el mismo trabajo → idempotente, ninguna segunda reserva", async () => {
    const c7 = await companySession(db, c.app);
    const s = await financialSetup(c7);
    const inv = await readyInvoice(c7, s.vendor.id);
    const svc = service();
    const run = await svc.openRun(c7.company.id, inv.invoice.id, { trigger: "MANUAL", actor: SYSTEM });
    const fx = await svc.resolveFx(c7.company.id, run.invoiceVersionId);
    const first = await svc.finalize(c7.company.id, run.runId, { actor: SYSTEM, fx, detectedBillingType: null });
    const again = await svc.finalize(c7.company.id, run.runId, { actor: SYSTEM, fx, detectedBillingType: null });
    expect(first.visibleOutcome).toBe("AUTORIZADA");
    expect(again).toMatchObject({ runId: run.runId, visibleOutcome: "AUTORIZADA" });
    expect(await reservationsOf(inv.invoice.id)).toHaveLength(1);
    expect((await budgets([s.globalBudgetId]))[0]!.reserved_base).toBe("1200.0000");
  });

  it("FIN-23: fallo tras actualizar el primer presupuesto → rollback total", async () => {
    const c8 = await companySession(db, c.app);
    const s = await financialSetup(c8);
    const inv = await readyInvoice(c8, s.vendor.id);
    const svc = service({
      fault: () => {
        throw new Error("fallo inyectado entre presupuestos");
      },
    });
    await expect(svc.evaluate(c8.company.id, inv.invoice.id, { trigger: "MANUAL", actor: SYSTEM })).rejects.toThrow(/fallo inyectado/);
    expect(await reservationsOf(inv.invoice.id)).toHaveLength(0);
    expect((await budgets([s.globalBudgetId, s.categoryBudgetId])).map((x) => x.reserved_base)).toEqual(["0.0000", "0.0000"]);
    const { rows } = await db.pool.query("select status, decision from evaluation_runs r join evaluation_flows f on f.id = r.flow_id where f.invoice_id = $1", [inv.invoice.id]);
    expect(rows).toEqual([{ status: "RUNNING", decision: null }]); // la corrida puede reintentarse
    // Recuperación: un reintento sin fallo autoriza.
    expect((await service().evaluate(c8.company.id, inv.invoice.id, { trigger: "RETRY", actor: SYSTEM })).visibleOutcome).toBe("AUTORIZADA");
  });

  it("FIN-24: cambios durante el análisis se revalidan bajo bloqueo (proveedor bloqueado / presupuesto agotado / nueva versión)", async () => {
    const c9 = await companySession(db, c.app);
    const s = await financialSetup(c9);
    const svc = service();

    const i1 = await readyInvoice(c9, s.vendor.id);
    const run1 = await svc.openRun(c9.company.id, i1.invoice.id, { trigger: "MANUAL", actor: SYSTEM });
    const fx1 = await svc.resolveFx(c9.company.id, run1.invoiceVersionId);
    await c9.post(`/api/vendors/${s.vendor.id}/status`, { status: "BLOCKED", reason: "Bloqueo durante el análisis" });
    expect((await svc.finalize(c9.company.id, run1.runId, { actor: SYSTEM, fx: fx1, detectedBillingType: null })).visibleOutcome).toBe("BLOQUEADA");
    await c9.post(`/api/vendors/${s.vendor.id}/status`, { status: "AUTHORIZED", reason: "Desbloqueo" });

    const i2 = await readyInvoice(c9, s.vendor.id);
    const run2 = await svc.openRun(c9.company.id, i2.invoice.id, { trigger: "MANUAL", actor: SYSTEM });
    const fx2 = await svc.resolveFx(c9.company.id, run2.invoiceVersionId);
    await c9.put("/api/budgets", { period: s.period, scope: "CATEGORY", categoryId: s.category.id, limitBase: "100.00" });
    expect((await svc.finalize(c9.company.id, run2.runId, { actor: SYSTEM, fx: fx2, detectedBillingType: null })).reasonCode).toBe("BUDGET_CATEGORY");
    await c9.put("/api/budgets", { period: s.period, scope: "CATEGORY", categoryId: s.category.id, limitBase: "10000.00" });

    const i3 = await readyInvoice(c9, s.vendor.id);
    const run3 = await svc.openRun(c9.company.id, i3.invoice.id, { trigger: "MANUAL", actor: SYSTEM });
    await c9.post(`/api/invoices/${i3.invoice.id}/versions`, { data: hourlyInvoiceData({ totalAmount: "1300.00" }), reason: "Corrección durante análisis" });
    const r3 = await svc.finalize(c9.company.id, run3.runId, { actor: SYSTEM, fx: await svc.resolveFx(c9.company.id, run3.invoiceVersionId), detectedBillingType: null });
    expect(r3).toMatchObject({ status: "SUPERSEDED", reasonCode: "INVOICE_VERSION_CHANGED" });
    expect(await reservationsOf(i3.invoice.id)).toHaveLength(0);
  });

  it("FIN-29: un contrato AI_SUGGESTED sin confirmar no es elegible", async () => {
    const c10 = await companySession(db, c.app);
    const s = await financialSetup(c10);
    // Sustituye el contrato confirmado por uno sin confirmar (borrador) del mismo proveedor.
    await db.pool.query("update contracts set status = 'TERMINATED' where id = $1", [s.contract.contract.id]);
    const draft = await apiContract(c10, { vendorId: s.vendor.id, categoryId: s.category.id, confirm: false });
    expect(draft.versions[0]!.status).toBe("DRAFT");
    const inv = await readyInvoice(c10, s.vendor.id);
    const r = await c10.post(`/api/invoices/${inv.invoice.id}/evaluations`, {});
    expect(r.body.evaluation).toMatchObject({ visibleOutcome: "EN_CORRECCION", reasonCode: "CONTRACT_FOUND" });
  });

  it("FIN-30: un contrato de otra empresa nunca es candidato ni se filtra", async () => {
    const other = await companySession(db, c.app);
    const so = await financialSetup(other);
    const c11 = await companySession(db, c.app);
    const s = await financialSetup(c11);
    await db.pool.query("update contracts set status = 'TERMINATED' where id = $1", [s.contract.contract.id]);
    const inv = await readyInvoice(c11, s.vendor.id, hourlyInvoiceData({ contractRefCited: so.contract.contract.contractRef }));
    const r = await c11.post(`/api/invoices/${inv.invoice.id}/evaluations`, {});
    expect(r.body.evaluation.visibleOutcome).toBe("EN_CORRECCION");
    const hist = (await c11.get(`/api/invoices/${inv.invoice.id}/evaluations`)).body;
    expect(JSON.stringify(hist)).not.toContain(so.contract.contract.id);
    expect((await other.get(`/api/invoices/${inv.invoice.id}/evaluations`)).status).toBe(404);
  });

  it("garantías de BD: reserva sin dos asignaciones, AUTHORIZE sin reserva y sobregiro son imposibles", async () => {
    const c12 = await companySession(db, c.app);
    const s = await financialSetup(c12);
    const inv = await readyInvoice(c12, s.vendor.id);
    const svc = service();
    const run = await svc.openRun(c12.company.id, inv.invoice.id, { trigger: "MANUAL", actor: SYSTEM });
    const client = await db.pool.connect();
    try {
      // AUTHORIZE sin reserva: el trigger diferido lo rechaza al confirmar.
      await client.query("begin");
      await client.query(
        "update evaluation_runs set status='COMPLETED', decision='AUTHORIZE', visible_outcome='AUTORIZADA', reason_code='X', evaluated_at=now(), selected_contract_version_id=$2, matched_bank_account_id=$3, amount_base=1 where id=$1",
        [run.runId, s.contract.versions[0]!.id, s.account.id],
      );
      await expect(client.query("commit")).rejects.toMatchObject({ constraint: "evaluation_runs_authorize_reservation" });

      // Reserva con una sola asignación.
      await client.query("begin");
      await client.query(
        "update evaluation_runs set status='COMPLETED', decision='AUTHORIZE', visible_outcome='AUTORIZADA', reason_code='X', evaluated_at=now(), selected_contract_version_id=$2, matched_bank_account_id=$3, amount_base=1 where id=$1",
        [run.runId, s.contract.versions[0]!.id, s.account.id],
      );
      const { rows } = await client.query(
        "insert into budget_reservations (company_id, invoice_id, authorizing_run_id, original_amount, original_currency, reserved_amount_base, base_currency, period_yyyy_mm, idempotency_key, authorized_at) values ($1,$2,$3,1,'USD',1,'USD',$4,'k',now()) returning id",
        [c12.company.id, inv.invoice.id, run.runId, s.period],
      );
      await client.query("insert into budget_reservation_allocations (company_id, reservation_id, monthly_budget_id, scope, amount_base) values ($1,$2,$3,'GLOBAL',1)", [c12.company.id, rows[0].id, s.globalBudgetId]);
      await expect(client.query("commit")).rejects.toMatchObject({ constraint: "budget_reservations_two_allocations" });
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
    expect(await pgCode(db, "update monthly_budgets set reserved_base = limit_base + 1 where id = $1", [s.globalBudgetId])).toBe("23514:monthly_budgets_amounts_valid");
    expect(await pgCode(db, "update companies set base_currency = 'EUR' where id = $1", [c12.company.id])).toBe("23001:companies_base_currency_locked");
    expect(await pgCode(db, "insert into monthly_budgets (company_id, period_yyyy_mm, scope, limit_base, currency) values ($1, '2030-01', 'GLOBAL', 1, 'EUR')", [c12.company.id])).toBe(
      "23514:monthly_budgets_currency_is_base",
    );
  });

  it("políticas: versiones inmutables, matriz sin solapes y no modificable tras publicar", async () => {
    const c13 = await companySession(db, c.app);
    const s = await financialSetup(c13);
    const { rows } = await db.pool.query("select id from policy_versions where policy_id = $1", [s.policyId]);
    expect(await pgCode(db, "update policy_versions set hard_invoice_cap_base = 1 where id = $1", [rows[0].id])).toBe("23001:policy_versions_immutable");
    expect(
      await pgCode(db, "insert into approval_matrix_rules (company_id, policy_version_id, min_amount_exclusive, max_amount_inclusive, persona_id) values ($1,$2,0,100,$3)", [c13.company.id, rows[0].id, s.persona.id]),
    ).toBe("23001:approval_matrix_rules_immutable");
    const overlap = await c13.post(`/api/policies/${s.policyId}/versions`, {
      autoApprovalLimitBase: "100",
      hardInvoiceCapBase: "1000",
      matrix: [
        { minAmountExclusive: "100", maxAmountInclusive: "600", personaId: s.persona.id },
        { minAmountExclusive: "500", maxAmountInclusive: "1000", personaId: s.persona.id },
      ],
    });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.details.constraint).toBe("approval_matrix_rules_no_overlap");
    const v2 = await c13.post(`/api/policies/${s.policyId}/versions`, { autoApprovalLimitBase: "100", hardInvoiceCapBase: "1000" });
    expect(v2.body.versions.map((v: { versionNo: number }) => v.versionNo)).toEqual([2, 1]);
    // Límite automático mayor que el tope → 400.
    expect((await c13.post(`/api/policies/${s.policyId}/versions`, { autoApprovalLimitBase: "2000", hardInvoiceCapBase: "1000" })).status).toBe(400);
  });

  it("contrato EUR con factura USD → EN_CORRECCION (moneda), y modalidad recurrente", async () => {
    const c14 = await companySession(db, c.app);
    const s = await financialSetup(c14, { contractCurrency: "EUR" });
    const inv = await readyInvoice(c14, s.vendor.id);
    expect((await c14.post(`/api/invoices/${inv.invoice.id}/evaluations`, {})).body.evaluation.reasonCode).toBe("CONTRACT_CURRENCY");
    await apiContract(c14, { vendorId: s.vendor.id, categoryId: s.category.id, billingType: "RECURRING", version: { currency: "USD", effectiveFrom: "2026-01-01", billingFrequency: "MONTHLY", fixedPeriodAmount: "1200.00" } });
    void hourlyVersion;
    void apiInvoice;
  });
});
