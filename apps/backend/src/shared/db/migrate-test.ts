import { getEnv } from "../../config/env.js";
import { createLogger } from "../logger.js";
import { runAllMigrations } from "./run-migrations.js";
import { assertTestDatabaseUrl } from "./test-database.js";

/** Migra explícitamente la base de pruebas definida en TEST_DATABASE_URL. */
const testUrl = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const env = { ...getEnv(), DATABASE_URL: testUrl, MIGRATION_DATABASE_URL: undefined, REMOTE_DB_CONFIRM: "" };
const logger = createLogger(env, "migrate-test");

try {
  await runAllMigrations(env, logger);
} catch (err) {
  logger.fatal({ err }, "Migración de pruebas fallida");
  process.exitCode = 1;
}
