import type { Env } from "../../config/env.js";
import type { Logger } from "../logger.js";
import { createDb, type DbHandle } from "./client.js";
import { recordOpsAudit } from "./ops-audit.js";
import { assertSafeDbTarget, describeDbTarget, formatDbTarget, UnsafeDbTargetError } from "./target.js";

export type ProvisioningEnv = Pick<
  Env,
  "DATABASE_URL" | "MIGRATION_DATABASE_URL" | "DATABASE_SSL" | "DATABASE_SSL_CA_FILE" | "REMOTE_DB_CONFIRM" | "NODE_ENV"
>;

/**
 * Ejecuta una operación de aprovisionamiento (DDL o datos iniciales) con:
 * identificación del destino y ambiente, guardia remota con confirmación exacta
 * y registro auditable de intento y resultado.
 * Usa MIGRATION_DATABASE_URL (rol con permisos DDL) si está definida.
 */
export async function withProvisioningDb<T>(
  operation: "migrate" | "seed",
  env: ProvisioningEnv,
  logger: Logger,
  fn: (handle: DbHandle) => Promise<T>,
): Promise<T> {
  const url = env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL;
  let target;
  try {
    target = assertSafeDbTarget(url, env.REMOTE_DB_CONFIRM, operation);
  } catch (err) {
    if (err instanceof UnsafeDbTargetError) {
      recordOpsAudit({ operation, target: describeDbTarget(url), nodeEnv: env.NODE_ENV, remoteConfirmed: false, phase: "refused", error: err.message });
    }
    throw err;
  }
  const audit = { operation, target, nodeEnv: env.NODE_ENV, remoteConfirmed: !target.isLocal };
  logger.info(
    { operation, target: formatDbTarget(target), nodeEnv: env.NODE_ENV, connection: env.MIGRATION_DATABASE_URL ? "MIGRATION_DATABASE_URL" : "DATABASE_URL" },
    "Destino de aprovisionamiento",
  );
  recordOpsAudit({ ...audit, phase: "attempt" });

  const handle = createDb({ ...env, DATABASE_URL: url, DATABASE_POOL_MAX: 1 }, logger, `blinka-${operation}`);
  try {
    const result = await fn(handle);
    recordOpsAudit({ ...audit, phase: "success" });
    return result;
  } catch (err) {
    recordOpsAudit({ ...audit, phase: "failure", error: err instanceof Error ? err.message : String(err) });
    throw err;
  } finally {
    await handle.close();
  }
}
