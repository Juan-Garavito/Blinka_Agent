import { pino, stdSerializers, type Logger } from "pino";
import { pgErrorOf } from "./errors/pg-error.js";
import type { Env } from "../config/env.js";

/** Rutas que nunca deben aparecer en los logs. */
export const REDACT_PATHS = [
  "password",
  "*.password",
  "passwordHash",
  "*.passwordHash",
  "token",
  "*.token",
  "secret",
  "*.secret",
  "apiKey",
  "*.apiKey",
  "connectionString",
  "*.connectionString",
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "*.MIGRATION_DATABASE_URL",
  "SUPABASE_ACCESS_TOKEN",
  "*.SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
  "*.SUPABASE_DB_PASSWORD",
  "SUPABASE_SERVICE_ROLE_KEY",
  "*.SUPABASE_SERVICE_ROLE_KEY",
  "ACCOUNT_FINGERPRINT_SECRET",
  "GEMINI_API_KEY",
  "*.GEMINI_API_KEY",
  "apiKey",
  'req.headers["x-goog-api-key"]',
  "accountNumber",
  "*.accountNumber",
  "*.DATABASE_URL",
  "csrfToken",
  "*.csrfToken",
  "passwordHash",
  "req.headers.authorization",
  'req.headers["x-csrf-token"]',
  "req.headers.cookie",
  'res.headers["set-cookie"]',
];

/**
 * Serializador de errores: nunca registra los parámetros de una consulta
 * (DrizzleQueryError los incluye en `message`) ni el `detail` de PostgreSQL
 * (contiene valores de fila). De un error de BD solo quedan código y restricción.
 */
export function safeErrorSerializer(err: unknown): Record<string, unknown> {
  const pg = pgErrorOf(err);
  if (pg) return { type: "DatabaseError", ...pg };
  if (err instanceof Error) {
    const s = stdSerializers.err(err) as unknown as Record<string, unknown>;
    delete s.params;
    delete s.detail;
    return s;
  }
  return { value: typeof err };
}

export function createLogger(env: Pick<Env, "LOG_LEVEL" | "LOG_FORMAT">, name: string, destination?: NodeJS.WritableStream): Logger {
  const options = {
    name,
    level: env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    serializers: { err: safeErrorSerializer },
    ...(env.LOG_FORMAT === "pretty"
      ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss.l" } } }
      : {}),
  };
  return destination ? pino(options, destination) : pino(options);
}

export type { Logger };
