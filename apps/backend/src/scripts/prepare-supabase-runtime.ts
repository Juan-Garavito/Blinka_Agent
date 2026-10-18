import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getEnv } from "../config/env.js";
import { withProvisioningDb } from "../shared/db/provisioning.js";
import { describeDbTarget } from "../shared/db/target.js";
import { createLogger } from "../shared/logger.js";

const env = getEnv();
try {
  const ref = readFileSync(fileURLToPath(new URL("../../../../supabase/.temp/project-ref", import.meta.url)), "utf8").trim();
  const target = describeDbTarget(env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL);
  const url = new URL(env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL);
  if (target.isLocal || target.database !== "postgres" || !(target.host === `db.${ref}.supabase.co` || (target.host.endsWith(".pooler.supabase.com") && decodeURIComponent(url.username).endsWith(`.${ref}`)))) throw new Error("Destino no coincide con proyecto vinculado/base postgres");
  if (env.DATABASE_SSL !== "verify-full") throw new Error("Se requiere TLS verify-full");
  if (!process.argv.includes("--apply")) {
    process.stdout.write(JSON.stringify({ status: "AWAITING_AUTHORIZATION", project: ref, target, sql: "scripts/prepare-supabase-runtime.sql", writes: 0 }) + "\n");
  } else {
    // assertSafeDbTarget de withProvisioningDb requiere confirmación EXACTA,
    // registra intento/resultado y solo entonces abre la conexión DDL.
    await withProvisioningDb("migrate", env, createLogger({ LOG_LEVEL: "silent", LOG_FORMAT: "json" }, "supabase-runtime"), (handle) => handle.pool.query(readFileSync(fileURLToPath(new URL("../../../../scripts/prepare-supabase-runtime.sql", import.meta.url)), "utf8")));
    process.stdout.write(JSON.stringify({ status: "PREPARED", project: ref, target }) + "\n");
  }
} catch {
  process.stdout.write(JSON.stringify({ status: "BLOCKED", reason: "Revisar vínculo, TLS, destino y autorización; no se imprimen credenciales" }) + "\n");
  process.exitCode = 1;
}
