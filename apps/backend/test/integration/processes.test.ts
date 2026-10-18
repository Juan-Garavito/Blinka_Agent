import { makeWorkerUtils } from "graphile-worker";
import { describe, expect, it } from "vitest";
import { enqueue } from "../../src/jobs/enqueue.js";
import { createDb } from "../../src/shared/db/client.js";
import { silentLogger, testDatabaseUrl } from "../helpers/env.js";
import { freePort, spawnEntrypoint } from "../helpers/process.js";

const processEnv = () => ({ NODE_ENV: "test", LOG_FORMAT: "json", LOG_LEVEL: "info", DATABASE_URL: testDatabaseUrl() });

describe("arranque de procesos independientes", () => {
  it("API: arranca, responde /health y /ready, y cierra limpio con SIGTERM", async () => {
    const port = await freePort();
    const api = spawnEntrypoint("src/server.ts", { ...processEnv(), PORT: String(port), HOST: "127.0.0.1" });
    try {
      await api.waitFor(/API escuchando/);
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect(health.status).toBe(200);
      const ready = await fetch(`http://127.0.0.1:${port}/ready`);
      expect(ready.status).toBe(200);

      api.child.kill("SIGTERM");
      expect(await api.exited).toBe(0);
      expect(api.output()).toMatch(/Cierre completado/);
      expect(api.output()).not.toMatch(/blinka_local_dev/); // la contraseña nunca aparece en logs
    } finally {
      api.child.kill("SIGKILL");
    }
  });

  it("Worker: arranca, procesa system_ping y cierra limpio con SIGTERM", async () => {
    const worker = spawnEntrypoint("src/worker.ts", processEnv());
    const db = createDb({ DATABASE_URL: testDatabaseUrl(), DATABASE_POOL_MAX: 1, DATABASE_SSL: "disable" }, silentLogger, "blinka-test-enqueue");
    const utils = await makeWorkerUtils({ pgPool: db.pool });
    try {
      await worker.waitFor(/Worker iniciado/);
      const job = await enqueue(utils, "system_ping", { note: "proceso-worker" });
      await worker.waitFor(new RegExp(`system_ping ejecutada \\(job ${job.id},`));

      worker.child.kill("SIGTERM");
      expect(await worker.exited).toBe(0);
      expect(worker.output()).toMatch(/Cierre completado/);
      expect(worker.output()).not.toMatch(/blinka_local_dev/);
    } finally {
      worker.child.kill("SIGKILL");
      await utils.release();
      await db.close();
    }
  });

  it("Worker: se niega a arrancar contra una base remota sin REMOTE_DB_CONFIRM", async () => {
    const worker = spawnEntrypoint("src/worker.ts", {
      ...processEnv(),
      DATABASE_URL: "postgres://user:TopSecret@db.example.supabase.co:5432/postgres",
    });
    expect(await worker.exited).not.toBe(0);
    expect(worker.output()).toMatch(/rechazada/);
    expect(worker.output()).not.toMatch(/TopSecret/);
  });

  it("API: no arranca con configuración inválida", async () => {
    const api = spawnEntrypoint("src/server.ts", { NODE_ENV: "test", PORT: "no-es-puerto" });
    expect(await api.exited).not.toBe(0);
    expect(api.output()).toMatch(/DATABASE_URL/);
    expect(api.output()).toMatch(/PORT/);
  });
});
