import { makeWorkerUtils, type WorkerUtils } from "graphile-worker";
import { assertSafeDbTarget } from "../shared/db/target.js";
import { assertSessionConnection } from "../integration/connection.js";
import type pg from "pg";
import { toGraphileLogger } from "./graphile-logger.js";
import type { Logger } from "../shared/logger.js";

/**
 * Acceso perezoso a la cola desde la API (solo inserta trabajos; no ejecuta
 * migraciones de negocio. makeWorkerUtils PUEDE migrar Graphile: se aplica
 * la misma guardia remota que al worker antes de inicializarlo).
 */
export function createJobQueue(pool: pg.Pool, logger: Logger, remoteConfirm = ""): Pick<WorkerUtils, "addJob"> & { release(): Promise<void> } {
  let utils: Promise<WorkerUtils> | undefined;
  const get = () => {
    const url = pool.options.connectionString;
    if (url) {
      assertSessionConnection(url);
      assertSafeDbTarget(url, remoteConfirm, "api-queue");
    }
    return utils ??= makeWorkerUtils({ pgPool: pool, logger: toGraphileLogger(logger) });
  };
  return {
    addJob: async (...args) => (await get()).addJob(...args),
    release: async () => {
      if (utils) await (await utils).release();
    },
  };
}
