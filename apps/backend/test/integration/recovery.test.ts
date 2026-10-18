import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { JobHelpers } from "graphile-worker";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FakeAIProvider, FIXTURE_MARKER } from "../../src/agents/ai/fake.provider.js";
import { createCoreServices } from "../../src/composition.js";
import { createTaskHandlers } from "../../src/jobs/handlers.js";
import { enqueue } from "../../src/jobs/enqueue.js";
import { createJobQueue } from "../../src/jobs/queue.js";
import { startWorker } from "../../src/jobs/runner.js";
import { analysisRunHandler } from "../../src/jobs/tasks/analysis-run.js";
import { recoverStaleRuns } from "../../src/jobs/tasks/recover-stale-runs.js";
import { renderInvoiceDocument } from "../../src/modules/demo/invoice-document.js";
import { LocalDocumentStorage } from "../../src/modules/documents/storage.js";
import { FixtureFxProvider } from "../../src/modules/fx/fx.providers.js";
import type { DbHandle } from "../../src/shared/db/client.js";
import { silentLogger } from "../helpers/env.js";
import { apiInvoice, financialSetup, hourlyInvoiceData } from "../helpers/commercial.js";
import { companySession, makeTestApp, openTestDb, testApiEnv, TEST_FX_RATES, type CompanySession } from "../helpers/identity.js";

const SYSTEM = { kind: "SYSTEM" as const, ref: "test" };

describe("Trabajo 4 — recuperación automática de evaluaciones atascadas (Graphile + PostgreSQL reales)", () => {
  let db: DbHandle;
  let storage: LocalDocumentStorage;
  beforeAll(async () => {
    db = await openTestDb();
    storage = new LocalDocumentStorage(mkdtempSync(path.join(tmpdir(), "blinka-rec-")));
  });
  afterAll(async () => {
    await db?.close();
  });

  const core = () => createCoreServices({ env: testApiEnv(), db, logger: silentLogger, storage, fxProvider: new FixtureFxProvider(TEST_FX_RATES), aiProvider: new FakeAIProvider() });
  const recover = (maxRecoveries = 2) => recoverStaleRuns({ db: db.db, evaluations: core().evaluations, logger: silentLogger, config: { staleMinutes: 15, maxRecoveries } });
  const helpers = { job: { id: "t", attempts: 1 }, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as unknown as JobHelpers;
  const runHandler = (companyId: string, runId: string) => {
    const k = core();
    return analysisRunHandler({ db: db.db, evaluations: k.evaluations, makePipeline: (a) => k.makePipeline(a) })({ companyId, runId }, helpers);
  };

  /** Factura lista + corrida RUNNING "abandonada": sin trabajo en cola, etapa de extracción RUNNING de hace 1 h. */
  async function stuckRun() {
    const c: CompanySession = await companySession(db, makeTestApp(db, { storage }));
    const s = await financialSetup(c);
    const data = hourlyInvoiceData();
    const marker = `${FIXTURE_MARKER}${Buffer.from(JSON.stringify({ documentKind: "INVOICE", billingType: "HOURLY", ...data, evidence: [], warnings: [] })).toString("base64")}`;
    const up = await c.upload("/api/documents?kind=INVOICE", renderInvoiceDocument(data, { marker }), "application/pdf", "f.pdf");
    const inv = await apiInvoice(c, { vendorId: s.vendor.id, documentId: up.body.document.id });
    const ts = await c.upload("/api/documents?kind=EVIDENCE", renderInvoiceDocument({ supplierInvoiceNumber: "HOJA-1" }), "application/pdf", "h.pdf");
    await c.post(`/api/invoices/${inv.invoice.id}/attachments`, { documentId: ts.body.document.id, purpose: "TIMESHEET" });
    const run = await core().evaluations.openRun(c.company.id, inv.invoice.id, { trigger: "UPLOAD", actor: SYSTEM });
    await db.pool.query("update evaluation_runs set started_at = now() - interval '1 hour' where id = $1", [run.runId]);
    await db.pool.query(
      `insert into agent_stage_runs (company_id, evaluation_run_id, stage_code, attempt_no, status, input_fingerprint, started_at)
       values ($1, $2, 'EXTRACT_CLASSIFY', 1, 'RUNNING', repeat('a', 64), now() - interval '50 minutes')`,
      [c.company.id, run.runId],
    );
    return { c, s, inv, run };
  }
  const jobsFor = async (runId: string) => (await db.pool.query<{ key: string }>("select key from graphile_worker.jobs where key like $1 order by key", [`analysis:${runId}%`])).rows.map((r) => r.key);
  const reservations = async (invoiceId: string) => (await db.pool.query("select count(*)::int as n from budget_reservations where invoice_id = $1", [invoiceId])).rows[0].n as number;

  it("caída a mitad de la extracción: se cierra la etapa huérfana, se reencola y la reanudación autoriza una sola vez", async () => {
    const { c, inv, run } = await stuckRun();
    const report = await recover();
    expect(report.requeued).toContain(run.runId);
    expect(await jobsFor(run.runId)).toEqual([`analysis:${run.runId}:recover:1`]);
    const { rows: st } = await db.pool.query("select status, error_code from agent_stage_runs where evaluation_run_id = $1", [run.runId]);
    expect(st).toEqual([{ status: "FAILED", error_code: "ABANDONED" }]);

    await runHandler(c.company.id, run.runId);
    const progress = (await c.get(`/api/evaluation-runs/${run.runId}`)).body;
    expect(progress.result.visibleOutcome).toBe("AUTORIZADA");
    expect((progress.stages as Array<{ stage: string; status: string }>).map((x) => `${x.stage}:${x.status}`)).toEqual([
      "EXTRACT_CLASSIFY:FAILED",
      "EXTRACT_CLASSIFY:SUCCEEDED",
      "CONTRACT_MATCH:SUCCEEDED",
      "CONTRACT_VALIDATE:SUCCEEDED",
      "FINANCIAL_DECISION:SUCCEEDED",
    ]);
    // Reentrega del trabajo de recuperación y nuevas pasadas: sin efectos.
    await runHandler(c.company.id, run.runId);
    expect((await recover()).requeued).not.toContain(run.runId);
    expect(await reservations(inv.invoice.id)).toBe(1);
    const { rows: audit } = await db.pool.query("select details from audit_events where entity_ref = $1 and event_type = 'evaluation.recovery_enqueued'", [run.runId]);
    expect(audit).toEqual([{ details: expect.objectContaining({ attempt: 1, abandonedStages: 1 }) as unknown }]);
  });

  it("con un trabajo vivo en la cola (pendiente o en proceso) no se toca la corrida", async () => {
    const { c, run } = await stuckRun();
    const queue = createJobQueue(db.pool, silentLogger);
    await enqueue(queue, "analysis_run", { companyId: c.company.id, runId: run.runId }, { jobKey: `analysis:${run.runId}`, runAt: new Date(Date.now() + 3_600_000) });
    const report = await recover();
    expect(report.skippedLiveJob).toContain(run.runId);
    expect(await jobsFor(run.runId)).toEqual([`analysis:${run.runId}`]);
    await queue.release();
    await db.pool.query("select graphile_worker.remove_job($1)", [`analysis:${run.runId}`]);
  });

  it("agotadas las recuperaciones → ERROR técnico STALE_RUN (reintento manual disponible), sin reserva", async () => {
    const { c, inv, run } = await stuckRun();
    const report = await recover(0);
    expect(report.failed).toContain(run.runId);
    expect((await c.get(`/api/evaluation-runs/${run.runId}`)).body.result).toMatchObject({ visibleOutcome: "ERROR", reasonCode: "STALE_RUN", decision: null });
    expect(await reservations(inv.invoice.id)).toBe(0);
    // El reintento manual abre otra corrida en el mismo trámite.
    expect((await c.post(`/api/invoices/${inv.invoice.id}/analysis`, {})).status).toBe(202);
  });

  it("dos recuperaciones simultáneas → un único reencolado y un único evento", async () => {
    const { run } = await stuckRun();
    await Promise.all([recover(), recover()]);
    expect(await jobsFor(run.runId)).toEqual([`analysis:${run.runId}:recover:1`]);
    const { rows } = await db.pool.query("select count(*)::int as n from audit_events where entity_ref = $1 and event_type = 'evaluation.recovery_enqueued'", [run.runId]);
    expect(rows[0].n).toBe(1);
  });

  it("caída tras confirmar la decisión: la corrida ya está COMPLETED; solo se cierra la etapa huérfana", async () => {
    const { c, inv, run } = await stuckRun();
    await db.pool.query("update agent_stage_runs set status = 'FAILED', error_code = 'TEST', finished_at = now() where evaluation_run_id = $1", [run.runId]);
    await runHandler(c.company.id, run.runId);
    await db.pool.query(
      `insert into agent_stage_runs (company_id, evaluation_run_id, stage_code, attempt_no, status, input_fingerprint, started_at)
       values ($1, $2, 'FINANCIAL_DECISION', 9, 'RUNNING', repeat('b', 64), now() - interval '1 hour')`,
      [c.company.id, run.runId],
    );
    const report = await recover();
    expect(report.orphanStagesClosed).toBeGreaterThanOrEqual(1);
    expect(report.requeued).not.toContain(run.runId);
    expect(await jobsFor(run.runId)).toEqual([]);
    expect(await reservations(inv.invoice.id)).toBe(1);
  });

  it("el worker real registra la tarea periódica de recuperación (cron de Graphile)", async () => {
    const k = core();
    const runner = await startWorker({
      pool: db.pool,
      logger: silentLogger,
      env: { WORKER_CONCURRENCY: 1 },
      handlers: createTaskHandlers({ db: db.db, core: k, logger: silentLogger, recovery: { staleMinutes: 15, maxRecoveries: 2 } }),
      recoveryCron: "*/5 * * * *",
      pollInterval: 200,
    });
    try {
      await vi.waitFor(
        async () => {
          const { rows } = await db.pool.query("select identifier from graphile_worker._private_known_crontabs where identifier = 'recover_stale_runs'");
          expect(rows).toHaveLength(1);
        },
        { timeout: 10000, interval: 200 },
      );
    } finally {
      await runner.stop();
    }
  });
});
