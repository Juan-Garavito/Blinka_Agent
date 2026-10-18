import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createDb, pingDb, type DbHandle } from "../../src/shared/db/client.js";
import { runAllMigrations } from "../../src/shared/db/run-migrations.js";
import { describeDbTarget } from "../../src/shared/db/target.js";
import { silentLogger, testDatabaseUrl } from "../helpers/env.js";

const dbEnv = (url: string) => ({ DATABASE_URL: url, DATABASE_POOL_MAX: 2, DATABASE_SSL: "disable" as const });

describe("PostgreSQL local de pruebas", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    const url = testDatabaseUrl();
    await runAllMigrations({ ...dbEnv(url), REMOTE_DB_CONFIRM: "", NODE_ENV: "test" }, silentLogger);
    handle = createDb(dbEnv(url), silentLogger, "blinka-test");
  });

  afterAll(async () => {
    await handle?.close();
  });

  it("está conectado a la base aislada *_test", async () => {
    const { rows } = await handle.pool.query<{ db: string }>("select current_database() as db");
    expect(rows[0]?.db).toBe(describeDbTarget(testDatabaseUrl()).database);
    expect(rows[0]?.db).toMatch(/_test$/);
  });

  it("las migraciones son idempotentes y crean los esquemas de control", async () => {
    const url = testDatabaseUrl();
    await runAllMigrations({ ...dbEnv(url), REMOTE_DB_CONFIRM: "", NODE_ENV: "test" }, silentLogger);
    const { rows } = await handle.pool.query<{ nspname: string }>(
      "select nspname from pg_namespace where nspname in ('drizzle','graphile_worker') order by 1",
    );
    expect(rows.map((r) => r.nspname)).toEqual(["drizzle", "graphile_worker"]);
  });

  it("NUMERIC se lee como string (sin coma flotante)", async () => {
    const { rows } = await handle.pool.query<{ v: unknown }>("select 0.1::numeric(20,6) + 0.2::numeric(20,6) as v");
    expect(rows[0]?.v).toBe("0.300000");
  });

  it("GET /ready → 200 con la base real", async () => {
    const app = createApp({ env: { JSON_BODY_LIMIT: "100kb", TRUST_PROXY: false }, logger: silentLogger, checkDatabase: () => pingDb(handle.pool) });
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
  });

  it("GET /ready → 503 si PostgreSQL no es alcanzable, sin exponer el destino", async () => {
    const down = createDb(dbEnv("postgres://blinka:pw@127.0.0.1:1/nadie_test"), silentLogger, "blinka-test-down");
    try {
      const app = createApp({ env: { JSON_BODY_LIMIT: "100kb", TRUST_PROXY: false }, logger: silentLogger, checkDatabase: () => pingDb(down.pool) });
      const res = await request(app).get("/ready");
      expect(res.status).toBe(503);
      expect(JSON.stringify(res.body)).not.toMatch(/127\.0\.0\.1|nadie_test|pw/);
    } finally {
      await down.close();
    }
  });
});
