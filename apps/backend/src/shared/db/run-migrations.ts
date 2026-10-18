import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { runMigrations as runWorkerMigrations } from "graphile-worker";
import { toGraphileLogger } from "../../jobs/graphile-logger.js";
import type { Logger } from "../logger.js";
import { withProvisioningDb, type ProvisioningEnv } from "./provisioning.js";

export const MIGRATIONS_FOLDER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../drizzle",
);

/**
 * Aprovisionamiento de esquema: migraciones versionadas de Drizzle y esquema
 * propio de Graphile Worker (graphile_worker). Es la ÚNICA vía prevista para
 * DDL en entornos remotos.
 */
export async function runAllMigrations(env: ProvisioningEnv, logger: Logger): Promise<void> {
  await withProvisioningDb("migrate", env, logger, async (handle) => {
    await migrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER });
    logger.info("Migraciones de aplicación (Drizzle) al día");
    await runWorkerMigrations({ pgPool: handle.pool, logger: toGraphileLogger(logger) });
    logger.info("Esquema de Graphile Worker al día");
  });
}
