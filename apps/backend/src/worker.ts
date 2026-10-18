import { assertSessionConnection } from "./integration/connection.js";
import { getEnv } from "./config/env.js";
import { createAIProvider, createCoreServices } from "./composition.js";
import { createTaskHandlers } from "./jobs/handlers.js";
import { startWorker } from "./jobs/runner.js";
import { createDocumentStorage } from "./modules/documents/storage-factory.js";
import { createFxProvider } from "./modules/fx/fx.factory.js";
import { createDb } from "./shared/db/client.js";
import { assertSafeDbTarget, formatDbTarget } from "./shared/db/target.js";
import { createLogger } from "./shared/logger.js";
import { onShutdown } from "./shared/shutdown.js";

const env = getEnv();
// Comprobación del entorno efectivo del MISMO entrypoint sin conectar ni arrancar
// Graphile y sin enviar solicitudes al proveedor.
if (process.argv.includes("--check-config")) {
  process.stdout.write(JSON.stringify({ entrypoint: "worker", provider: env.AI_PROVIDER, model: env.GEMINI_MODEL, geminiKeyPresent: Boolean(env.GEMINI_API_KEY), processBudget: env.AI_MAX_REQUESTS_PER_PROCESS ? { maxRequests: env.AI_MAX_REQUESTS_PER_PROCESS, maxCostUsd: env.AI_MAX_COST_USD_PER_PROCESS } : null, storage: env.STORAGE_DRIVER, remoteWrites: false, geminiRequests: 0 }) + "\n");
  process.exit(0);
}
const logger = createLogger(env, "worker");

// Graphile Worker instala/actualiza su esquema al arrancar: se aplica la misma
// guardia que a las migraciones para no modificar bases remotas sin autorización.
assertSessionConnection(env.DATABASE_URL);
const target = assertSafeDbTarget(env.DATABASE_URL, env.REMOTE_DB_CONFIRM, "worker");
const db = createDb(env, logger, "blinka-worker");

try {
  const aiProvider = createAIProvider(env);
  const core = createCoreServices({ env, db, logger, storage: createDocumentStorage(env), fxProvider: createFxProvider(env), aiProvider });
  const runner = await startWorker({
    pool: db.pool,
    logger,
    env,
    recoveryCron: env.RECOVERY_CRON,
    handlers: createTaskHandlers({ db: db.db, core, logger, recovery: { staleMinutes: env.RECOVERY_STALE_MINUTES, maxRecoveries: env.RECOVERY_MAX_ATTEMPTS } }),
  });
  logger.info(
    { db: formatDbTarget(target), concurrency: env.WORKER_CONCURRENCY, aiProvider: aiProvider.name, aiSimulated: aiProvider.isSimulated, fxProvider: env.FX_PROVIDER },
    "Worker iniciado",
  );

  onShutdown(logger, env.SHUTDOWN_TIMEOUT_MS, [() => runner.stop("shutdown"), db.close]);

  runner.promise.catch((err: unknown) => {
    logger.fatal({ err }, "El runner terminó con error");
    process.exitCode = 1;
  });
} catch (err) {
  logger.fatal({ err }, "No se pudo iniciar el worker");
  await db.close();
  process.exitCode = 1;
}
