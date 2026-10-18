import { z } from "zod";
import type { JobHelpers } from "graphile-worker";

/**
 * Tarea inocua de diagnóstico: valida su payload y registra un log.
 * No accede a datos de negocio, no llama a IA ni a servicios externos.
 */
export const systemPingPayload = z.object({
  note: z.string().max(200).optional(),
});

export type SystemPingPayload = z.infer<typeof systemPingPayload>;

export function systemPing(payload: SystemPingPayload, helpers: JobHelpers): void {
  helpers.logger.info(`system_ping ejecutada (job ${helpers.job.id}, intento ${helpers.job.attempts})`, {
    note: payload.note,
  });
}
