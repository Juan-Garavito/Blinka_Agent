import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import type { WorkerUtils } from "graphile-worker";
import type pg from "pg";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../shared/db/client.js";
import { AppError, notFound } from "../../shared/errors/app-error.js";
import { ctxOf, idParam } from "../../shared/http/context.js";
import { PgRateLimitStore } from "../../shared/http/pg-rate-limit-store.js";
import { enqueue } from "../../jobs/enqueue.js";
import { invoiceVersions } from "../invoices/invoices.schema.js";
import type { EvaluationService } from "./evaluation.service.js";
import { contracts, contractVersions } from "../contracts/contracts.schema.js";
import { agentStageRuns, evaluationContractCandidates, evaluationEvidence, evaluationFlows, evaluationRuns, type StageCode } from "./evaluations.schema.js";

const PHASE: Record<StageCode, string> = {
  EXTRACT_CLASSIFY: "extracting",
  CONTRACT_MATCH: "matching",
  CONTRACT_VALIDATE: "validating",
  FINANCIAL_DECISION: "deciding",
};

const startBody = z.object({ justification: z.string().trim().min(3).max(500).optional() }).strict();

/**
 * Análisis asíncrono (B4): encola y responde de inmediato; el frontend consulta
 * el progreso por polling (ARCH-006). Las etapas mostradas son las REALES
 * registradas en agent_stage_runs; sin porcentajes ficticios ni razonamiento.
 */
export function analysisRouter(deps: {
  db: Database;
  pool: pg.Pool;
  evaluations: EvaluationService;
  queue: Pick<WorkerUtils, "addJob">;
  limits: { maxPendingPerCompany: number; perHour: number; staleRunMinutes: number };
}): Router {
  const { db } = deps;
  const router = Router();

  // Rutas costosas (IA): límite por empresa, compartido entre instancias (PostgreSQL).
  const limiter: RequestHandler = rateLimit({
    windowMs: 3_600_000,
    limit: deps.limits.perHour,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    identifier: "analysis",
    store: new PgRateLimitStore(deps.pool, "analysis"),
    keyGenerator: (req) => `company:${req.company?.id ?? "none"}`,
    handler: (_req, _res, next) => next(new AppError(429, "RATE_LIMITED", "Demasiados análisis solicitados; inténtalo más tarde")),
  });

  router.post("/invoices/:id/analysis", limiter, async (req, res) => {
    const ctx = ctxOf(req);
    const invoiceId = idParam(req, "id");
    const body = startBody.parse(req.body ?? {});

    const [running] = await db
      .select({ runId: evaluationRuns.id, startedAt: evaluationRuns.startedAt })
      .from(evaluationRuns)
      .innerJoin(evaluationFlows, eq(evaluationFlows.id, evaluationRuns.flowId))
      .where(and(eq(evaluationRuns.companyId, ctx.companyId), eq(evaluationFlows.invoiceId, invoiceId), eq(evaluationRuns.status, "RUNNING")));
    if (running) {
      // Una corrida atascada (p. ej. el worker murió en el último intento) se cierra como ERROR técnico
      // para permitir un reintento manual seguro; una reciente sigue bloqueando el doble análisis.
      if (Date.now() - running.startedAt.getTime() < deps.limits.staleRunMinutes * 60_000) {
        throw new AppError(409, "ANALYSIS_IN_PROGRESS", "Ya hay un análisis en curso para esta factura", { details: { runId: running.runId } });
      }
      await deps.evaluations.finalizeTechnicalError(ctx.companyId, running.runId, { actor: ctx.actor, errorCode: "STALE_RUN", reason: "Corrida sin progreso cerrada antes de un reintento manual" });
    }

    const [{ pending }] = (await db
      .select({ pending: sql<number>`count(*)::int` })
      .from(evaluationRuns)
      .where(and(eq(evaluationRuns.companyId, ctx.companyId), eq(evaluationRuns.status, "RUNNING")))) as [{ pending: number }];
    if (pending >= deps.limits.maxPendingPerCompany) {
      throw new AppError(429, "ANALYSIS_QUEUE_FULL", "Demasiados análisis pendientes para la empresa; espera a que terminen");
    }

    const [prior] = await db.select({ id: evaluationFlows.id }).from(evaluationFlows).where(eq(evaluationFlows.invoiceId, invoiceId)).limit(1);
    const opened = await deps.evaluations.openRun(ctx.companyId, invoiceId, {
      trigger: prior ? "RETRY" : "UPLOAD",
      actor: ctx.actor,
      ...(body.justification ? { justification: body.justification } : {}),
    });
    // jobKey por corrida: un doble envío no crea dos trabajos.
    await enqueue(deps.queue, "analysis_run", { companyId: ctx.companyId, runId: opened.runId }, { jobKey: `analysis:${opened.runId}`, jobKeyMode: "unsafe_dedupe" });
    res.status(202).json({ runId: opened.runId, flowId: opened.flowId, runNo: opened.runNo, processing: "queued", pollUrl: `/api/evaluation-runs/${opened.runId}` });
  });

  router.get("/evaluation-runs/:id", async (req, res) => {
    const ctx = ctxOf(req);
    const runId = idParam(req, "id");
    const [row] = await db
      .select({ run: evaluationRuns, invoiceId: invoiceVersions.invoiceId })
      .from(evaluationRuns)
      .innerJoin(invoiceVersions, eq(invoiceVersions.id, evaluationRuns.invoiceVersionId))
      .where(and(eq(evaluationRuns.id, runId), eq(evaluationRuns.companyId, ctx.companyId)));
    if (!row) throw notFound("Evaluación no encontrada");
    const stages = await db
      .select({
        stage: agentStageRuns.stageCode,
        attemptNo: agentStageRuns.attemptNo,
        status: agentStageRuns.status,
        reused: sql<boolean>`${agentStageRuns.reusedFromStageRunId} is not null`,
        errorCode: agentStageRuns.errorCode,
        startedAt: agentStageRuns.startedAt,
        finishedAt: agentStageRuns.finishedAt,
      })
      .from(agentStageRuns)
      .where(and(eq(agentStageRuns.evaluationRunId, runId), eq(agentStageRuns.companyId, ctx.companyId)))
      .orderBy(asc(agentStageRuns.startedAt), asc(agentStageRuns.attemptNo));
    const run = row.run;
    const active = [...stages].reverse().find((s) => s.status === "RUNNING");
    const last = stages[stages.length - 1];
    const processing =
      run.status !== "RUNNING" ? (run.visibleOutcome === "ERROR" ? "failed" : "finished") : active ? PHASE[active.stage] : last ? PHASE[last.stage] : "queued";
    res.set("Cache-Control", "no-store").json({
      runId: run.id,
      flowId: run.flowId,
      invoiceId: row.invoiceId,
      runNo: run.runNo,
      processing,
      terminal: run.status !== "RUNNING",
      stages,
      result: run.status === "RUNNING" ? null : { status: run.status, decision: run.decision, visibleOutcome: run.visibleOutcome, reasonCode: run.reasonCode, amountBase: run.amountBase, baseCurrency: run.baseCurrency },
    });
  });

  /** Evidencias verificables de una corrida (página, posición, fragmento real) y contratos examinados. */
  router.get("/evaluation-runs/:id/evidence", async (req, res) => {
    const ctx = ctxOf(req);
    const runId = idParam(req, "id");
    const [run] = await db.select({ id: evaluationRuns.id }).from(evaluationRuns).where(and(eq(evaluationRuns.id, runId), eq(evaluationRuns.companyId, ctx.companyId)));
    if (!run) throw notFound("Evaluación no encontrada");
    const evidence = await db.select().from(evaluationEvidence).where(and(eq(evaluationEvidence.evaluationRunId, runId), eq(evaluationEvidence.companyId, ctx.companyId))).orderBy(asc(evaluationEvidence.sourceField));
    const candidates = await db
      .select({ id: evaluationContractCandidates.id, contractVersionId: evaluationContractCandidates.contractVersionId, contractId: contractVersions.contractId, contractRef: contracts.contractRef, billingType: contracts.billingType, versionNo: contractVersions.versionNo, typeMatch: evaluationContractCandidates.typeMatch, referenceMatch: evaluationContractCandidates.referenceMatch, selected: evaluationContractCandidates.selected, reason: evaluationContractCandidates.reason })
      .from(evaluationContractCandidates)
      .innerJoin(contractVersions, eq(contractVersions.id, evaluationContractCandidates.contractVersionId))
      .innerJoin(contracts, eq(contracts.id, contractVersions.contractId))
      .where(and(eq(evaluationContractCandidates.evaluationRunId, runId), eq(evaluationContractCandidates.companyId, ctx.companyId)));
    res.json({ runId, evidence, candidates });
  });

  return router;
}
