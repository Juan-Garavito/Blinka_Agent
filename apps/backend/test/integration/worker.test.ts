import { makeWorkerUtils, type Runner, type WorkerUtils } from "graphile-worker";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { enqueue } from "../../src/jobs/enqueue.js";
import { startWorker } from "../../src/jobs/runner.js";
import { systemPing } from "../../src/jobs/tasks/system-ping.js";
import { createDb, type DbHandle } from "../../src/shared/db/client.js";
import { runAllMigrations } from "../../src/shared/db/run-migrations.js";
import { silentLogger, testDatabaseUrl } from "../helpers/env.js";

describe("Graphile Worker con cola PostgreSQL local", () => {
  let handle: DbHandle;
  let runner: Runner;
  let utils: WorkerUtils;

  beforeAll(async () => {
    const env = { DATABASE_URL: testDatabaseUrl(), DATABASE_POOL_MAX: 5, DATABASE_SSL: "disable" as const };
    await runAllMigrations({ ...env, REMOTE_DB_CONFIRM: "", NODE_ENV: "test" }, silentLogger);
    handle = createDb(env, silentLogger, "blinka-test-worker");
    runner = await startWorker({ pool: handle.pool, logger: silentLogger, env: { WORKER_CONCURRENCY: 1 }, handlers: { system_ping: systemPing }, pollInterval: 200 });
    utils = await makeWorkerUtils({ pgPool: handle.pool });
  });

  afterAll(async () => {
    await utils?.release();
    await runner?.stop();
    await handle?.close();
  });

  it("ejecuta la tarea inocua system_ping encolada con enqueue()", async () => {
    const job = await enqueue(utils, "system_ping", { note: "b0-test" });
    expect(job.max_attempts).toBe(1);
    // Graphile Worker persiste la finalización por lotes: se comprueba el estado
    // real en la BD (job completado ⇒ eliminado de la cola) en lugar de eventos.
    await vi.waitFor(
      async () => {
        const { rows } = await handle.pool.query("select 1 from graphile_worker.jobs where id = $1", [job.id]);
        expect(rows).toHaveLength(0);
      },
      { timeout: 10000, interval: 100 },
    );
  });

  it("un payload inválido insertado sin enqueue() falla sin reintentos", async () => {
    const job = await utils.addJob("system_ping", { note: 42 }, { maxAttempts: 1 });
    const row = await vi.waitFor(
      async () => {
        const { rows } = await handle.pool.query<{ attempts: number; max_attempts: number; last_error: string | null }>(
          "select attempts, max_attempts, last_error from graphile_worker.jobs where id = $1",
          [job.id],
        );
        expect(rows[0]?.last_error).toBeTruthy();
        return rows[0];
      },
      { timeout: 10000, interval: 100 },
    );
    // Falló una sola vez y no queda pendiente de reintento (attempts = max_attempts).
    expect(row).toMatchObject({ attempts: 1, max_attempts: 1 });
    expect(row?.last_error).toMatch(/note/);
    await utils.completeJobs([job.id]); // limpieza: elimina el job fallido de la cola de pruebas
  });
});
