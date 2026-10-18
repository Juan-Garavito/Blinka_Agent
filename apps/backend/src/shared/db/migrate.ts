import { getEnv } from "../../config/env.js";
import { createLogger } from "../logger.js";
import { runAllMigrations } from "./run-migrations.js";

const env = getEnv();
const logger = createLogger(env, "migrate");

try {
  await runAllMigrations(env, logger);
} catch (err) {
  logger.fatal({ err }, "Migración fallida");
  process.exitCode = 1;
}
