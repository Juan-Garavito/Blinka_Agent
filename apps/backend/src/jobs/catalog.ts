import type { JobHelpers, TaskList } from "graphile-worker";
import { z } from "zod";
import { systemPingPayload } from "./tasks/system-ping.js";

/**
 * Techo global de intentos por tarea. Graphile Worker usa 25 si no se indica;
 * aquí ninguna tarea puede declarar más de este valor. Las tareas que consumen
 * IA usan valores bajos (≤ 3) para acotar coste y llamadas.
 */
export const MAX_TASK_ATTEMPTS = 5;

interface TaskSpec<S extends z.ZodType> {
  payload: S;
  /** Intentos máximos de la tarea (1..MAX_TASK_ATTEMPTS). Obligatorio y explícito. */
  maxAttempts: number;
}

export function defineTask<S extends z.ZodType>(d: TaskSpec<S> & Record<string, unknown>): TaskSpec<S> {
  if (!Number.isInteger(d.maxAttempts) || d.maxAttempts < 1 || d.maxAttempts > MAX_TASK_ATTEMPTS) {
    throw new Error(`maxAttempts debe ser un entero entre 1 y ${MAX_TASK_ATTEMPTS}`);
  }
  return { payload: d.payload, maxAttempts: d.maxAttempts };
}

export const analysisRunPayload = z.object({ companyId: z.uuid(), runId: z.uuid() }).strict();
/** Payload de las tareas periódicas (cron de Graphile añade `_cron`). */
export const cronPayload = z.object({ _cron: z.object({ ts: z.string(), backfilled: z.boolean().optional() }).optional() }).strict();

/** Catálogo cerrado de tareas (contratos de payload y reintentos). Añadir aquí cada tarea nueva. */
export const taskCatalog = {
  system_ping: defineTask({ payload: systemPingPayload, maxAttempts: 1 }),
  analysis_run: defineTask({ payload: analysisRunPayload, maxAttempts: 3 }),
  recover_stale_runs: defineTask({ payload: cronPayload, maxAttempts: 1 }),
} as const;

export type TaskName = keyof typeof taskCatalog;
export type TaskPayload<N extends TaskName> = z.infer<(typeof taskCatalog)[N]["payload"]>;
export type TaskHandlers = { [N in TaskName]?: (payload: TaskPayload<N>, helpers: JobHelpers) => void | Promise<void> };

/**
 * TaskList para Graphile Worker, con dos defensas para jobs insertados sin
 * `enqueue()` (p. ej. con el máximo de 25 de la librería):
 * - si el intento supera el maxAttempts declarado, el handler NO se ejecuta;
 * - el payload se revalida: si es inválido, falla sin ejecutar el handler.
 */
export function buildTaskList(handlers: TaskHandlers): TaskList {
  const list: TaskList = {};
  for (const [name, spec] of Object.entries(taskCatalog)) {
    const handler = handlers[name as TaskName] as ((p: unknown, h: JobHelpers) => void | Promise<void>) | undefined;
    if (!handler) continue;
    list[name] = async (raw, helpers) => {
      if (helpers.job.attempts > spec.maxAttempts) {
        helpers.logger.error(`Job ${helpers.job.id} (${name}) descartado: intento ${helpers.job.attempts} supera maxAttempts=${spec.maxAttempts}`);
        return;
      }
      const payload: unknown = spec.payload.parse(raw);
      await handler(payload, helpers);
    };
  }
  return list;
}
