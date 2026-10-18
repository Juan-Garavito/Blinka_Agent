import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../shared/db/client.js";
import type { Logger } from "../../shared/logger.js";
import { auditEvents } from "../../modules/audit/audit.schema.js";
import { recordAudit } from "../../modules/audit/audit.service.js";
import type { EvaluationService } from "../../modules/evaluations/evaluation.service.js";
import { agentStageRuns, evaluationRuns } from "../../modules/evaluations/evaluations.schema.js";
import { taskCatalog } from "../catalog.js";

export interface RecoveryConfig {
  /** Minutos sin actividad (ni de la corrida ni de sus etapas) para considerarla atascada. */
  staleMinutes: number;
  /** Reencolados automáticos máximos por corrida; agotados, la corrida termina en ERROR técnico. */
  maxRecoveries: number;
}

export interface RecoveryReport {
  examined: number;
  requeued: string[];
  failed: string[];
  skippedLiveJob: string[];
  orphanStagesClosed: number;
}

const SYSTEM = { kind: "SYSTEM" as const, ref: "stale-run-recovery" };

/**
 * Recuperación controlada de evaluaciones atascadas (p. ej. el worker murió a
 * mitad de una etapa). Usa los checkpoints existentes:
 * - una corrida RUNNING sin actividad y SIN trabajo vivo en la cola se reencola;
 *   las etapas válidas se reutilizarán por huella y la decisión financiera es
 *   idempotente (reserva única por factura, estado de la corrida bajo bloqueo);
 * - las etapas huérfanas en RUNNING se cierran como FAILED · ABANDONED (historia intacta);
 * - agotadas las recuperaciones, la corrida se cierra como ERROR técnico (reintento manual).
 * Nunca crea reservas ni decide: solo reencola o cierra como error técnico.
 */
export async function recoverStaleRuns(deps: { db: Database; evaluations: EvaluationService; logger: Logger; config: RecoveryConfig }): Promise<RecoveryReport> {
  const { db, config } = deps;
  const report: RecoveryReport = { examined: 0, requeued: [], failed: [], skippedLiveJob: [], orphanStagesClosed: 0 };
  const stale = sql`now() - make_interval(mins => ${config.staleMinutes})`;

  // 0. Etapas RUNNING de corridas ya finalizadas (p. ej. caída justo tras confirmar la decisión).
  const closed = await db.execute(sql`
    update agent_stage_runs s set status = 'FAILED', error_code = 'ABANDONED', error_retryable = false, finished_at = now()
      from evaluation_runs r
     where r.id = s.evaluation_run_id and s.status = 'RUNNING' and r.status <> 'RUNNING'`);
  report.orphanStagesClosed += closed.rowCount ?? 0;

  // 1. Candidatas: RUNNING y sin actividad reciente (ni en la corrida ni en sus etapas).
  const { rows: candidates } = await db.execute<{ id: string; company_id: string }>(sql`
    select r.id, r.company_id from evaluation_runs r
     where r.status = 'RUNNING'
       and greatest(r.started_at, coalesce((select max(greatest(s.started_at, coalesce(s.finished_at, s.started_at))) from agent_stage_runs s where s.evaluation_run_id = r.id), r.started_at)) < ${stale}
     order by r.started_at
     limit 100`);
  report.examined = candidates.length;

  for (const cand of candidates) {
    const outcome = await db.transaction(async (tx) => {
      // SKIP LOCKED: otra recuperación (u otro worker finalizando) la tiene; se reintenta en el próximo ciclo.
      const [run] = await tx.select({ status: evaluationRuns.status }).from(evaluationRuns).where(eq(evaluationRuns.id, cand.id)).for("update", { skipLocked: true });
      if (!run || run.status !== "RUNNING") return "skip" as const;
      // ¿Hay un trabajo vivo (pendiente/reintento programado o bloqueado recientemente) para esta corrida?
      const { rows: live } = await tx.execute(sql`
        select 1 from graphile_worker.jobs
         where (key = ${`analysis:${cand.id}`} or key like ${`analysis:${cand.id}:recover:%`})
           and attempts < max_attempts and (locked_at is null or locked_at > ${stale})
         limit 1`);
      if (live.length > 0) return "live" as const;

      const abandoned = await tx
        .update(agentStageRuns)
        .set({ status: "FAILED", errorCode: "ABANDONED", errorRetryable: true, finishedAt: new Date() })
        .where(and(eq(agentStageRuns.evaluationRunId, cand.id), eq(agentStageRuns.status, "RUNNING")))
        .returning({ id: agentStageRuns.id });
      report.orphanStagesClosed += abandoned.length;

      const [{ n }] = (await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(auditEvents)
        .where(and(eq(auditEvents.companyId, cand.company_id), eq(auditEvents.eventType, "evaluation.recovery_enqueued"), eq(auditEvents.entityRef, cand.id)))) as [{ n: number }];
      if (n >= config.maxRecoveries) return "exhausted" as const;

      const attempt = n + 1;
      const payload = taskCatalog.analysis_run.payload.parse({ companyId: cand.company_id, runId: cand.id });
      // Reencolado en la MISMA transacción que su auditoría; clave única por intento de recuperación.
      await tx.execute(sql`select graphile_worker.add_job(
        'analysis_run', ${JSON.stringify(payload)}::json,
        max_attempts := ${taskCatalog.analysis_run.maxAttempts}, job_key := ${`analysis:${cand.id}:recover:${attempt}`}, job_key_mode := 'unsafe_dedupe')`);
      await recordAudit(tx, {
        companyId: cand.company_id,
        actor: SYSTEM,
        eventType: "evaluation.recovery_enqueued",
        entityType: "evaluation_run",
        entityRef: cand.id,
        details: { attempt, maxRecoveries: config.maxRecoveries, abandonedStages: abandoned.length, staleMinutes: config.staleMinutes },
      });
      return "requeued" as const;
    });

    if (outcome === "live") report.skippedLiveJob.push(cand.id);
    if (outcome === "requeued") report.requeued.push(cand.id);
    if (outcome === "exhausted") {
      await deps.evaluations.finalizeTechnicalError(cand.company_id, cand.id, { actor: SYSTEM, errorCode: "STALE_RUN", reason: `Sin progreso tras ${config.maxRecoveries} recuperaciones automáticas; reintento manual disponible` });
      report.failed.push(cand.id);
    }
  }
  if (report.examined > 0 || report.orphanStagesClosed > 0) deps.logger.warn(report, "Recuperación de evaluaciones atascadas");
  return report;
}
