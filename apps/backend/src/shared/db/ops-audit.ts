import { appendFileSync, mkdirSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatDbTarget, type DbTarget } from "./target.js";

/**
 * Registro append-only (JSON Lines) de operaciones de aprovisionamiento:
 * migraciones y seeds. Se escribe en la máquina del operador ANTES de conectar
 * (intento) y al terminar (resultado). Nunca contiene credenciales.
 * OPS_AUDIT_FILE=stdout lo emite como línea JSON en la salida estándar
 * (contenedores: los logs de la plataforma son el registro persistente).
 */
export const DEFAULT_OPS_AUDIT_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.ops-audit/db-operations.jsonl",
);

export interface OpsAuditEntry {
  operation: "migrate" | "seed";
  phase: "attempt" | "success" | "failure" | "refused";
  target: DbTarget;
  nodeEnv: string;
  remoteConfirmed: boolean;
  error?: string;
}

function actor(): string {
  try {
    return userInfo().username;
  } catch {
    return "desconocido";
  }
}

export function recordOpsAudit(entry: OpsAuditEntry, file = process.env.OPS_AUDIT_FILE ?? DEFAULT_OPS_AUDIT_FILE): void {
  const line = {
    at: new Date().toISOString(),
    actor: actor(),
    operation: entry.operation,
    phase: entry.phase,
    target: formatDbTarget(entry.target),
    host: entry.target.host,
    database: entry.target.database,
    isLocal: entry.target.isLocal,
    nodeEnv: entry.nodeEnv,
    remoteConfirmed: entry.remoteConfirmed,
    ...(entry.error ? { error: entry.error.slice(0, 300) } : {}),
  };
  if (file === "stdout") {
    process.stdout.write(`${JSON.stringify({ audit: "db-operation", ...line })}\n`);
    return;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  // Si no se puede registrar, la operación no debe continuar: se propaga el error.
  appendFileSync(file, `${JSON.stringify(line)}\n`, { encoding: "utf8", mode: 0o600 });
}
