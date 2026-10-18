import type { JobHelpers } from "graphile-worker";
import { and, eq } from "drizzle-orm";
import type { Database } from "../../shared/db/client.js";
import { AIProviderError } from "../../agents/ai/types.js";
import { HarnessError } from "../../agents/harness.js";
import type { createAnalysisPipeline, PipelineDeps } from "../../agents/pipeline.js";
import { RetryableStageError } from "../../agents/pipeline.js";
import type { EvaluationService } from "../../modules/evaluations/evaluation.service.js";
import { evaluationRuns } from "../../modules/evaluations/evaluations.schema.js";
import { taskCatalog, type TaskPayload } from "../catalog.js";

/**
 * Handler de la tarea analysis_run. Idempotente ante reentregas: una corrida
 * ya finalizada no se reprocesa. Un fallo temporal se relanza para que la cola
 * reintente (las etapas válidas se reutilizan por huella); agotados los
 * intentos o ante un fallo permanente, la corrida termina en ERROR técnico.
 */
export function analysisRunHandler(deps: {
  db: Database;
  evaluations: EvaluationService;
  makePipeline: (attempt: NonNullable<PipelineDeps["attempt"]>) => ReturnType<typeof createAnalysisPipeline>;
}) {
  const max = taskCatalog.analysis_run.maxAttempts;
  return async (payload: TaskPayload<"analysis_run">, helpers: JobHelpers) => {
    const [run] = await deps.db
      .select({ status: evaluationRuns.status })
      .from(evaluationRuns)
      .where(and(eq(evaluationRuns.id, payload.runId), eq(evaluationRuns.companyId, payload.companyId)));
    if (!run) {
      helpers.logger.error(`analysis_run: corrida ${payload.runId} inexistente para la empresa; se descarta`);
      return;
    }
    if (run.status !== "RUNNING") {
      helpers.logger.info(`analysis_run: corrida ${payload.runId} ya finalizada (${run.status}); reentrega ignorada`);
      return;
    }
    try {
      await deps.makePipeline({ current: helpers.job.attempts, max }).run(payload.companyId, payload.runId);
    } catch (err) {
      const retryable = err instanceof AIProviderError ? err.retryable : err instanceof RetryableStageError ? true : !(err instanceof HarnessError);
      if (retryable && helpers.job.attempts < max) throw err;
      const code = err instanceof AIProviderError || err instanceof HarnessError || err instanceof RetryableStageError ? err.code : "UNEXPECTED";
      await deps.evaluations.finalizeTechnicalError(payload.companyId, payload.runId, {
        actor: { kind: "SYSTEM", ref: "analysis-pipeline" },
        errorCode: `PIPELINE_${code}`,
        reason: retryable ? `Reintentos agotados (${max}); reintento manual disponible` : "Fallo técnico permanente; reintento manual disponible",
      });
      helpers.logger.warn(`analysis_run: corrida ${payload.runId} cerrada en ERROR (${code})`);
    }
  };
}
