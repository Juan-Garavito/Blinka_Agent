import { readFileSync } from "node:fs";
import type { ConnectionOptions } from "node:tls";
import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Env } from "../../config/env.js";
import type { Logger } from "../logger.js";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;

export interface DbHandle {
  pool: pg.Pool;
  db: Database;
  close: () => Promise<void>;
}

export type DbEnv = Pick<Env, "DATABASE_URL" | "DATABASE_POOL_MAX" | "DATABASE_SSL"> &
  Partial<Pick<Env, "DATABASE_SSL_CA_FILE">>;

/**
 * Traduce DATABASE_SSL a opciones TLS de pg (misma semántica que sslmode de libpq):
 * - disable: sin TLS.
 * - require: cifra, pero NO verifica la identidad del servidor (rejectUnauthorized=false).
 * - verify-full: cifra y verifica cadena + nombre de host; usa la CA indicada o las del sistema.
 */
export function buildSslOptions(env: Pick<DbEnv, "DATABASE_SSL" | "DATABASE_SSL_CA_FILE">): false | ConnectionOptions {
  switch (env.DATABASE_SSL) {
    case "disable":
      return false;
    case "require":
      return { rejectUnauthorized: false };
    case "verify-full":
      return {
        rejectUnauthorized: true,
        ...(env.DATABASE_SSL_CA_FILE ? { ca: readFileSync(env.DATABASE_SSL_CA_FILE, "utf8") } : {}),
      };
  }
}

// NUMERIC (1700) se devuelve como string: nunca convertir importes a float.
// Es el comportamiento por defecto de pg; se declara para que nadie lo cambie
// sin darse cuenta.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => v);

export function createDb(env: DbEnv, logger: Logger, applicationName: string): DbHandle {
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    ssl: buildSslOptions(env),
    application_name: applicationName,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });
  // Sin este listener, un error en un cliente inactivo tumbaría el proceso.
  pool.on("error", (err) => logger.error({ err }, "Error en cliente inactivo del pool PostgreSQL"));
  // Igual para clientes en uso (p. ej. la conexión LISTEN de Graphile Worker).
  pool.on("connect", (client) => {
    client.on("error", (err) => logger.error({ err }, "Error en cliente activo de PostgreSQL"));
  });

  let closed = false;
  return {
    pool,
    db: drizzle(pool, { schema }),
    close: async () => {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  };
}

/** Comprobación de disponibilidad con tiempo máximo. */
export async function pingDb(pool: pg.Pool, timeoutMs = 2000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });
  try {
    await Promise.race([pool.query("select 1"), timeout]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
