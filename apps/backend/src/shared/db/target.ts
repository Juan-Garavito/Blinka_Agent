/**
 * Identificación y guardia del destino de base de datos.
 * Toda operación que modifica esquema (migraciones de Drizzle o de Graphile
 * Worker) debe pasar por `assertSafeDbTarget` antes de conectar.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres"]);

export interface DbTarget {
  host: string;
  port: string;
  database: string;
  isLocal: boolean;
}

/** Datos no secretos del destino: nunca incluye usuario ni contraseña. */
export function describeDbTarget(connectionString: string): DbTarget {
  const url = new URL(connectionString);
  const host = url.hostname;
  return {
    host,
    port: url.port || "5432",
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    isLocal: LOCAL_HOSTS.has(host.toLowerCase()),
  };
}

export function formatDbTarget(t: DbTarget): string {
  return `${t.host}:${t.port}/${t.database} (${t.isLocal ? "local" : "REMOTO"})`;
}

export class UnsafeDbTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeDbTargetError";
  }
}

/**
 * Permite destinos locales. Un destino remoto solo se acepta si
 * `confirm` es exactamente "<host>/<database>", lo que obliga a una
 * autorización explícita y específica del destino.
 */
export function assertSafeDbTarget(connectionString: string, confirm: string, operation: string): DbTarget {
  const target = describeDbTarget(connectionString);
  if (target.isLocal) return target;
  const expected = `${target.host}/${target.database}`;
  if (confirm !== expected) {
    throw new UnsafeDbTargetError(
      `Operación "${operation}" rechazada: el destino ${formatDbTarget(target)} no es local. ` +
        `Para autorizarla expresamente define REMOTE_DB_CONFIRM="${expected}".`,
    );
  }
  return target;
}
