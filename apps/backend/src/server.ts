import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { getEnv } from "./config/env.js";
import { createApiRouter } from "./api.js";
import { createApp } from "./app.js";
import { createDocumentStorage } from "./modules/documents/storage-factory.js";
import { createFxProvider } from "./modules/fx/fx.factory.js";
import { createAIProvider } from "./composition.js";
import { createJobQueue } from "./jobs/queue.js";
import { createDb, pingDb } from "./shared/db/client.js";
import { describeDbTarget, formatDbTarget } from "./shared/db/target.js";
import { createLogger } from "./shared/logger.js";
import { onShutdown } from "./shared/shutdown.js";

const env = getEnv();
const logger = createLogger(env, "api");
const db = createDb(env, logger, "blinka-api");
const queue = createJobQueue(db.pool, logger, env.REMOTE_DB_CONFIRM);

const frontendDir = fileURLToPath(new URL("../../web/dist/", import.meta.url));
const app = createApp({
  frontendDir: existsSync(frontendDir) ? frontendDir : undefined,
  env,
  logger,
  checkDatabase: () => pingDb(db.pool),
  apiRouter: createApiRouter({ env, db, logger, storage: createDocumentStorage(env), fxProvider: createFxProvider(env), aiProvider: createAIProvider(env), queue }),
});

const server = app.listen(env.PORT, env.HOST, () => {
  logger.info(
    { host: env.HOST, port: env.PORT, nodeEnv: env.NODE_ENV, db: formatDbTarget(describeDbTarget(env.DATABASE_URL)) },
    "API escuchando",
  );
});
server.on("error", (err) => {
  logger.fatal({ err }, "No se pudo iniciar el servidor HTTP");
  process.exit(1);
});

onShutdown(logger, env.SHUTDOWN_TIMEOUT_MS, [
  () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
      server.closeIdleConnections();
    }),
  () => queue.release(),
  db.close,
]);
