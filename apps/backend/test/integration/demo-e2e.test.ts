import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { JobHelpers } from "graphile-worker";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FakeAIProvider } from "../../src/agents/ai/fake.provider.js";
import { createCoreServices } from "../../src/composition.js";
import { analysisRunHandler } from "../../src/jobs/tasks/analysis-run.js";
import { seedDemo } from "../../src/modules/demo/demo.seed.js";
import { periodOf } from "../../src/modules/evaluations/decision-engine.js";
import { LocalDocumentStorage } from "../../src/modules/documents/storage.js";
import { FixtureFxProvider } from "../../src/modules/fx/fx.providers.js";
import type { DbHandle } from "../../src/shared/db/client.js";
import { silentLogger } from "../helpers/env.js";
import { companySession, makeTestApp, openTestDb, testApiEnv } from "../helpers/identity.js";

/** Tasas FIXTURE (SIMULADAS) iguales a las de la configuración por defecto de la demo. */
const DEMO_FX = "EUR:USD=1.0850,COP:USD=0.00024";

describe("B6 — demo local de extremo a extremo (API → cola → LangGraph → motor → BD)", () => {
  let db: DbHandle;
  let storageDir: string;
  beforeAll(async () => {
    db = await openTestDb();
    storageDir = mkdtempSync(path.join(tmpdir(), "blinka-demo-"));
  });
  afterAll(async () => {
    await db?.close();
  });

  it("15 escenarios ficticios producen el resultado esperado; cero autorizaciones indebidas", async () => {
    const storage = new LocalDocumentStorage(storageDir);
    const app = makeTestApp(db, { storage, fxProvider: new FixtureFxProvider(DEMO_FX), aiProvider: new FakeAIProvider() });
    const c = await companySession(db, app);
    const period = periodOf(new Date(), c.company.timezone);
    const seeded = await seedDemo({ db: db.db, storage, logger: silentLogger, companyId: c.company.id, userId: c.user.id, fingerprintSecret: process.env.ACCOUNT_FINGERPRINT_SECRET, period });
    expect(seeded.scenarios).toHaveLength(15);
    expect((await seedDemo({ db: db.db, storage, logger: silentLogger, companyId: c.company.id, userId: c.user.id, fingerprintSecret: process.env.ACCOUNT_FINGERPRINT_SECRET, period })).created).toBe(false);

    const core = createCoreServices({ env: testApiEnv(), db, logger: silentLogger, storage, fxProvider: new FixtureFxProvider(DEMO_FX), aiProvider: new FakeAIProvider() });
    const handler = analysisRunHandler({ db: db.db, evaluations: core.evaluations, makePipeline: (a) => core.makePipeline(a) });
    const helpers = (attempt: number) => ({ job: { id: "demo", attempts: attempt }, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }) as unknown as JobHelpers;

    const table: Array<{ code: string; title: string; expected: string; got: string; amountBase: string | null }> = [];
    for (const s of seeded.scenarios) {
      const start = await c.post(`/api/invoices/${s.invoiceId}/analysis`, {});
      expect(start.status, s.code).toBe(202);
      // Simula los intentos de la cola hasta que la corrida termine (máx. 3).
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await handler({ companyId: c.company.id, runId: start.body.runId }, helpers(attempt));
          break;
        } catch {
          /* fallo temporal: siguiente intento */
        }
      }
      const r = (await c.get(`/api/evaluation-runs/${start.body.runId}`)).body;
      table.push({ code: s.code, title: s.title, expected: s.expected, got: `${r.result.visibleOutcome} · ${r.result.reasonCode}`, amountBase: r.result.amountBase });
    }
    // Evidencia legible en la salida de la prueba.
    // eslint-disable-next-line no-console -- evidencia intencional de la demo en la salida de la prueba
    console.table(table);
    const got = Object.fromEntries(table.map((t) => [t.code, t.got]));
    expect(got).toMatchObject({
      A: "AUTORIZADA · ALL_CHECKS_PASSED",
      B: "BLOQUEADA · HARD_INVOICE_CAP",
      C: "EN_APROBACION · APPROVAL_REQUIRED",
      D: "BLOQUEADA · DUPLICATE_INVOICE",
      E: "BLOQUEADA · VENDOR_STATUS",
      F: "EN_APROBACION · VENDOR_STATUS",
      G: "EN_CORRECCION · HOURLY_RATE",
      H: "EN_CORRECCION · CONTRACT_FOUND",
      I: "BLOQUEADA · BUDGET_CATEGORY",
      J: "AUTORIZADA · ALL_CHECKS_PASSED",
      K: "AUTORIZADA · ALL_CHECKS_PASSED",
      L: "ERROR · FX_RATE",
      M: "EN_CORRECCION · EXTRACTION_QUALITY",
      N: "EN_CORRECCION · EVIDENCE_TOTAL_AMOUNT",
    });
    expect(got.O).toMatch(/^EN_CORRECCION · EVIDENCE_/);
    expect(table.find((t) => t.code === "J")!.amountBase).toBe("1085.0000");
    expect(table.find((t) => t.code === "K")!.amountBase).toBe("960.0000");

    // Cero autorizaciones indebidas: solo A, J y K tienen reserva; cada una con exactamente 2 asignaciones.
    const { rows } = await db.pool.query(
      "select r.invoice_id, count(a.*)::int as n from budget_reservations r join budget_reservation_allocations a on a.reservation_id = r.id where r.company_id = $1 group by r.invoice_id",
      [c.company.id],
    );
    const authorized = new Set(seeded.scenarios.filter((s) => ["A", "J", "K"].includes(s.code)).map((s) => s.invoiceId));
    expect(rows.map((r) => r.invoice_id).sort()).toEqual([...authorized].sort());
    expect(rows.every((r) => r.n === 2)).toBe(true);
    const dash = (await c.get("/api/dashboard")).body;
    expect(dash.invoicesByStatus).toMatchObject({ AUTORIZADA: 3, BLOQUEADA: 4, EN_APROBACION: 2, EN_CORRECCION: 5, ERROR: 1 });
    expect(dash.pendingApprovals).toBe(1);
    expect(dash.aiUsage[0]).toMatchObject({ provider: "FAKE (MOCK)", isSimulated: true });

    // O (escaneada) → no se puede verificar por texto: una persona corrobora los campos → reanálisis → AUTORIZADA.
    const o = seeded.scenarios.find((x) => x.code === "O")!;
    const oDetail = (await c.get(`/api/invoices/${o.invoiceId}`)).body;
    const pending = (await c.get(`/api/invoices/${o.invoiceId}/evaluations`)).body.flows[0].runs.at(-1).checks.filter((x: { outcome: string; ruleCode: string }) => x.outcome === "UNKNOWN" && x.ruleCode.startsWith("EVIDENCE_"));
    expect(pending.length).toBeGreaterThan(5);
    const fieldsToConfirm = (await db.pool.query<{ source_field: string }>("select source_field from evaluation_evidence e join evaluation_runs r on r.id = e.evaluation_run_id join evaluation_flows f on f.id = r.flow_id where f.invoice_id = $1 and e.verification_status = 'UNVERIFIABLE'", [o.invoiceId])).rows.map((r) => r.source_field);
    const conf = await c.post(`/api/invoices/${o.invoiceId}/versions/${oDetail.invoice.currentVersionId}/confirmations`, { fields: [...new Set(fieldsToConfirm)], reason: "Revisé la imagen original: los valores coinciden (demo)" });
    expect(conf.status, JSON.stringify(conf.body)).toBe(201);
    const reO = await c.post(`/api/invoices/${o.invoiceId}/evaluations`, { justification: "Evidencia corroborada por persona" });
    expect(reO.body.evaluation.visibleOutcome).toBe("AUTORIZADA");

    // C → aprobación simulada → reevaluación → AUTORIZADA.
    const reqs = (await c.get("/api/approval-requests?status=PENDING")).body.approvalRequests;
    const approve = await c.post(`/api/approval-requests/${reqs[0].id}/resolve`, { decision: "APPROVE", reason: "Aprobación simulada de demo" });
    expect(approve.body.evaluation.visibleOutcome).toBe("AUTORIZADA");
  });
});
