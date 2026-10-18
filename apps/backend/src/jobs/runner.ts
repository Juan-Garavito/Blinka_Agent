import { parseCronItems, run, type Runner } from "graphile-worker";
import type pg from "pg";
import type { Env } from "../config/env.js";
import type { Logger } from "../shared/logger.js";
import { buildTaskList, type TaskHandlers } from "./catalog.js";
import { toGraphileLogger } from "./graphile-logger.js";

export interface StartWorkerOptions {
  pool: pg.Pool;
  logger: Logger;
  env: Pick<Env, "WORKER_CONCURRENCY">;
  handlers: TaskHandlers;
  pollInterval?: number;
  /** Expresión cron de la recuperación automática; sin ella no hay tareas periódicas. */
  recoveryCron?: string;
}

/**
 * Arranca el runner de Graphile Worker sobre el pool compartido.
 * Las señales las gestiona el entrypoint (`noHandleSignals`) para cerrar
 * runner y pool en orden.
 */
export function startWorker({ pool, logger, env, handlers, pollInterval, recoveryCron }: StartWorkerOptions): Promise<Runner> {
  return run({
    pgPool: pool,
    taskList: buildTaskList(handlers),
    // Única tarea periódica: recuperación de evaluaciones atascadas (sin backfill: no recupera ticks perdidos).
    // Graphile garantiza una ejecución por tick aunque haya varios workers.
    parsedCronItems:
      recoveryCron && handlers.recover_stale_runs
        ? parseCronItems([{ task: "recover_stale_runs", match: recoveryCron, identifier: "recover_stale_runs", options: { backfillPeriod: 0, maxAttempts: 1, jobKey: "recover_stale_runs", jobKeyMode: "replace" } }])
        : [],
    concurrency: env.WORKER_CONCURRENCY,
    noHandleSignals: true,
    logger: toGraphileLogger(logger),
    ...(pollInterval ? { pollInterval } : {}),
  });
}
