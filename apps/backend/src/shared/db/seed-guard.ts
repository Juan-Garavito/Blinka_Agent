import { describeDbTarget, formatDbTarget } from "./target.js";

export class SeedForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedForbiddenError";
  }
}

/**
 * Los seeds se rechazan siempre en producción. Contra un host no local solo se aceptan con un consentimiento
 * PROPIO del seed (`SEED_REMOTE_CONFIRM` = "<host>/<base>" exacto), distinto de REMOTE_DB_CONFIRM: un valor
 * antiguo de migración no autoriza escribir datos. Devuelve el consentimiento a usar para la conexión.
 */
export function assertSeedTarget(url: string, nodeEnv: string, seedRemoteConfirm = ""): { remote: boolean; remoteConfirm: string } {
  if (nodeEnv === "production") throw new SeedForbiddenError("Seed rechazado: NODE_ENV=production");
  const target = describeDbTarget(url);
  if (target.isLocal) return { remote: false, remoteConfirm: "" };
  const expected = `${target.host}/${target.database}`;
  if (seedRemoteConfirm !== expected) {
    throw new SeedForbiddenError(`Seed rechazado: el destino ${formatDbTarget(target)} no es local. Solo con autorización expresa: SEED_REMOTE_CONFIRM="${expected}".`);
  }
  return { remote: true, remoteConfirm: expected };
}

/** Compatibilidad: guardia estrictamente local (sin consentimiento remoto). */
export function assertLocalSeedTarget(url: string, nodeEnv: string): void {
  assertSeedTarget(url, nodeEnv, "");
}
