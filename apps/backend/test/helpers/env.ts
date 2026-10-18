import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertTestDatabaseUrl } from "../../src/shared/db/test-database.js";
import { createLogger } from "../../src/shared/logger.js";

/** Raíz del workspace backend, independiente del directorio desde el que se lance vitest. */
export const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Vitest no carga .env: se usa la API estándar de Node si existe el archivo.
const envFile = path.join(BACKEND_ROOT, ".env");
if (!process.env.TEST_DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

export const silentLogger = createLogger({ LOG_LEVEL: "silent", LOG_FORMAT: "json" }, "test");

/**
 * URL de la base de pruebas. Falla (no omite) si falta o no es local/_test:
 * las pruebas de integración nunca se dan por superadas sin infraestructura.
 */
export function testDatabaseUrl(): string {
  return assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
}

export const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://u:p@127.0.0.1:5432/x_test",
} as const;
