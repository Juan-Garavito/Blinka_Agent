import type { WorkerUtils, TaskSpec } from "graphile-worker";
import { taskCatalog, type TaskName, type TaskPayload } from "./catalog.js";

export type EnqueueOptions = Pick<TaskSpec, "jobKey" | "jobKeyMode" | "queueName" | "runAt" | "priority"> & {
  /** Solo puede reducir el maxAttempts declarado por la tarea, nunca ampliarlo. */
  maxAttempts?: number;
};

/**
 * Único punto de encolado. Valida el payload antes de insertarlo y aplica el
 * `maxAttempts` declarado por la tarea (nunca el 25 por defecto de la librería).
 */
export async function enqueue<N extends TaskName>(
  utils: Pick<WorkerUtils, "addJob">,
  name: N,
  payload: TaskPayload<N>,
  options: EnqueueOptions = {},
) {
  const def = taskCatalog[name];
  const maxAttempts = options.maxAttempts ?? def.maxAttempts;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > def.maxAttempts) {
    throw new RangeError(`maxAttempts para ${name} debe estar entre 1 y ${def.maxAttempts}`);
  }
  const parsed = def.payload.parse(payload);
  const identifier: string = name;
  return utils.addJob(identifier, parsed, { ...options, maxAttempts });
}
