import { Writable } from "node:stream";
import { DrizzleQueryError } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiRouter } from "../../src/api.js";
import { createApp } from "../../src/app.js";
import { FakeAIProvider } from "../../src/agents/ai/fake.provider.js";
import { createJobQueue } from "../../src/jobs/queue.js";
import { LocalDocumentStorage } from "../../src/modules/documents/storage.js";
import { FixtureFxProvider } from "../../src/modules/fx/fx.providers.js";
import { openApiDocument } from "../../src/openapi.js";
import { pingDb, type DbHandle } from "../../src/shared/db/client.js";
import { createLogger, safeErrorSerializer } from "../../src/shared/logger.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ACCOUNT_NUMBER, financialSetup, readyInvoice } from "../helpers/commercial.js";
import { TEST_FX_RATES, TEST_PASSWORD, companySession, makeTestApp, openTestDb, testApiEnv } from "../helpers/identity.js";

describe("B6 — contrato HTTP y ausencia de secretos en logs", () => {
  let db: DbHandle;
  beforeAll(async () => {
    db = await openTestDb();
  });
  afterAll(async () => {
    await db?.close();
  });

  it("cada operación del OpenAPI provisional existe en la app (nunca 404 sin sesión)", async () => {
    const app = makeTestApp(db);
    const fakeId = "00000000-0000-4000-8000-000000000000";
    const results: string[] = [];
    for (const [p, ops] of Object.entries(openApiDocument.paths)) {
      const url = p.replace(/\{[^}]+\}/g, fakeId) + (p === "/api/documents" ? "?kind=INVOICE" : p === "/api/budgets" ? "?period=2026-10" : "");
      for (const method of Object.keys(ops)) {
        const res = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[method]!(url).send(method === "get" ? undefined : {});
        if (res.status === 404) results.push(`${method.toUpperCase()} ${p}`);
      }
    }
    expect(results).toEqual([]);
    const spec = await request(app).get("/openapi.json");
    expect(spec.body.info.title).toMatch(/PROVISIONAL/);
  });

  it("un flujo completo no deja contraseñas, tokens, cuentas ni parámetros SQL en los logs", async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const logger = createLogger({ LOG_LEVEL: "trace", LOG_FORMAT: "json" }, "secrets-test", sink);
    const app = createApp({
      env: { JSON_BODY_LIMIT: "100kb", TRUST_PROXY: false },
      logger,
      checkDatabase: () => pingDb(db.pool),
      apiRouter: createApiRouter({
        env: testApiEnv(),
        db,
        logger,
        storage: new LocalDocumentStorage(mkdtempSync(path.join(tmpdir(), "blinka-sec-"))),
        fxProvider: new FixtureFxProvider(TEST_FX_RATES),
        aiProvider: new FakeAIProvider(),
        queue: createJobQueue(db.pool, logger),
      }),
    });
    const c = await companySession(db, app);
    const s = await financialSetup(c);
    const inv = await readyInvoice(c, s.vendor.id);
    await c.post(`/api/invoices/${inv.invoice.id}/evaluations`, {});
    await request(app).post("/api/auth/login").set("Origin", "http://localhost:5173").send({ email: c.user.email, password: "contraseña-incorrecta-XYZ" });
    await c.post("/api/categories", { code: "DUPLICADA", name: "a" });
    await c.post("/api/categories", { code: "DUPLICADA", name: "b" }); // 409 por restricción única

    const all = lines.join("");
    expect(all.length).toBeGreaterThan(1000);
    const token = c.session.cookie.split("=")[1]!;
    for (const secret of [TEST_PASSWORD, "contraseña-incorrecta-XYZ", token, c.session.csrfToken, ACCOUNT_NUMBER.replace(/\s/g, ""), "7654 3210", process.env.ACCOUNT_FINGERPRINT_SECRET!]) {
      expect(all).not.toContain(secret);
    }
    expect(all).not.toMatch(/\$argon2id\$/);
    expect(all).not.toMatch(/params:/);
  });

  it("el serializador de errores elimina parámetros de consultas (DrizzleQueryError)", () => {
    const cause = Object.assign(new Error("duplicate key"), { code: "23505", constraint: "users_email_key", detail: "Key (email)=(x@y.co) already exists" });
    const err = new DrizzleQueryError("insert into users values ($1, $2)", ["x@y.co", "$argon2id$v=19$secreto"], cause);
    const out = JSON.stringify(safeErrorSerializer(err));
    expect(out).toBe(JSON.stringify({ type: "DatabaseError", code: "23505", constraint: "users_email_key" }));
    expect(out).not.toContain("secreto");
  });
});
