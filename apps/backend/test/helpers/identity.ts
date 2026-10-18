import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import type { Express } from "express";
import { createApiRouter, type ApiEnv } from "../../src/api.js";
import { createApp } from "../../src/app.js";
import { LocalDocumentStorage, type DocumentStorage } from "../../src/modules/documents/storage.js";
import { FixtureFxProvider, type FxProvider } from "../../src/modules/fx/fx.providers.js";
import { FakeAIProvider } from "../../src/agents/ai/fake.provider.js";
import type { AIProvider } from "../../src/agents/ai/types.js";
import { createJobQueue } from "../../src/jobs/queue.js";
import type { Env } from "../../src/config/env.js";
import { companies, companyUsers, users } from "../../src/modules/identity/identity.schema.js";
import { hashPassword } from "../../src/modules/identity/password.js";
import { createDb, pingDb, type DbHandle } from "../../src/shared/db/client.js";
import { runAllMigrations } from "../../src/shared/db/run-migrations.js";
import { silentLogger, testDatabaseUrl } from "./env.js";

export const TEST_ORIGIN = "http://localhost:5173";
/** Tasas SIMULADAS de prueba (fixture), nunca reales. */
export const TEST_FX_RATES = "EUR:USD=1.0850,COP:USD=0.00024";

export const testApiEnv = (overrides: Partial<ApiEnv> = {}): ApiEnv => ({
  ALLOWED_ORIGINS: [TEST_ORIGIN],
  SESSION_TTL_HOURS: 12,
  SESSION_IDLE_TIMEOUT_MINUTES: 120,
  SESSION_COOKIE_SECURE: true,
  SESSION_COOKIE_SAMESITE: "strict",
  LOGIN_RATE_LIMIT_WINDOW_MINUTES: 15,
  LOGIN_RATE_LIMIT_PER_IP: 1000,
  LOGIN_RATE_LIMIT_PER_ACCOUNT: 1000,
  DOCUMENT_MAX_BYTES: 1024 * 1024,
  ACCOUNT_FINGERPRINT_SECRET: process.env.ACCOUNT_FINGERPRINT_SECRET,
  FX_MAX_AGE_HOURS: 96,
  FX_REUSE_MINUTES: 0,
  SUPPORTED_CURRENCIES: ["USD", "EUR", "COP", "GBP"],
  AI_MAX_CONCURRENCY: 2,
  AI_TIMEOUT_MS: 10000,
  AI_MAX_STEPS: 4,
  AI_MAX_OUTPUT_TOKENS: 4096,
  AI_MAX_TOTAL_TOKENS: 60000,
  AI_PRICE_INPUT_USD_PER_MTOK: "0.30",
  AI_PRICE_OUTPUT_USD_PER_MTOK: "2.50",
  ANALYSIS_MAX_PENDING_PER_COMPANY: 10,
  ANALYSIS_RATE_LIMIT_PER_HOUR: 1000,
  ANALYSIS_STALE_RUN_MINUTES: 30,
  ...overrides,
});

/** Migra la base de pruebas, limpia contadores de rate limit y abre un pool. */
export async function openTestDb(): Promise<DbHandle> {
  const url = testDatabaseUrl();
  const env = { DATABASE_URL: url, DATABASE_POOL_MAX: 5, DATABASE_SSL: "disable" as const };
  await runAllMigrations({ ...env, REMOTE_DB_CONFIRM: "", NODE_ENV: "test" }, silentLogger);
  const handle = createDb(env, silentLogger, "blinka-test");
  // Solo en la base *_test verificada: los contadores no deben arrastrarse entre ejecuciones.
  await handle.pool.query("delete from rate_limit_buckets");
  return handle;
}

export function makeTestApp(
  db: DbHandle,
  opts: { env?: Partial<ApiEnv>; trustProxy?: Env["TRUST_PROXY"]; now?: () => Date; storage?: DocumentStorage; fxProvider?: FxProvider; aiProvider?: AIProvider } = {},
): Express {
  const storage = opts.storage ?? new LocalDocumentStorage(mkdtempSync(path.join(tmpdir(), "blinka-docs-")));
  return createApp({
    env: { JSON_BODY_LIMIT: "100kb", TRUST_PROXY: opts.trustProxy ?? false },
    logger: silentLogger,
    checkDatabase: () => pingDb(db.pool),
    apiRouter: createApiRouter({
      env: testApiEnv(opts.env),
      db,
      logger: silentLogger,
      storage,
      fxProvider: opts.fxProvider ?? new FixtureFxProvider(TEST_FX_RATES),
      aiProvider: opts.aiProvider ?? new FakeAIProvider(),
      queue: createJobQueue(db.pool, silentLogger),
      ...(opts.now ? { now: opts.now } : {}),
    }),
  });
}

export const uniqueEmail = (tag = "user") => `${tag}-${randomUUID().slice(0, 8)}@test.blinka.local`;
export const TEST_PASSWORD = "Prueba-Segura-123!";

export async function createCompany(db: DbHandle, values: Partial<typeof companies.$inferInsert> = {}) {
  const [row] = await db.db
    .insert(companies)
    .values({ name: `Empresa ficticia ${randomUUID().slice(0, 6)}`, baseCurrency: "USD", timezone: "America/Bogota", ...values })
    .returning();
  return row!;
}

export async function createUser(db: DbHandle, opts: { email?: string; password?: string; active?: boolean } = {}) {
  const email = opts.email ?? uniqueEmail();
  const [row] = await db.db
    .insert(users)
    .values({ email, passwordHash: await hashPassword(opts.password ?? TEST_PASSWORD), active: opts.active ?? true })
    .returning();
  return row!;
}

export async function addMembership(db: DbHandle, companyId: string, userId: string, active = true) {
  await db.db.insert(companyUsers).values({ companyId, userId, active });
}

export interface LoggedIn {
  cookie: string;
  csrfToken: string;
  body: { user: { id: string; email: string }; companies: Array<{ id: string }>; csrfToken: string; expiresAt: string };
}

/** Extrae "nombre=valor" del Set-Cookie de sesión (supertest no reenvía cookies Secure por http). */
export function sessionCookieFrom(res: request.Response): string | undefined {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith("__Host-blinka_session="))?.split(";")[0];
}

export async function login(app: Express, email: string, password = TEST_PASSWORD, cookie?: string): Promise<LoggedIn> {
  const req = request(app).post("/api/auth/login").set("Origin", TEST_ORIGIN);
  if (cookie) req.set("Cookie", cookie);
  const res = await req.send({ email, password });
  if (res.status !== 200) throw new Error(`login falló: ${res.status} ${JSON.stringify(res.body)}`);
  return { cookie: sessionCookieFrom(res)!, csrfToken: res.body.csrfToken as string, body: res.body as LoggedIn["body"] };
}

/** Cliente autenticado con empresa propia: añade Origin y token CSRF a las peticiones mutantes. */
export async function companySession(db: DbHandle, app?: Express) {
  const company = await createCompany(db);
  const user = await createUser(db);
  await addMembership(db, company.id, user.id);
  const theApp = app ?? makeTestApp(db);
  const s = await login(theApp, user.email);
  const withAuth = (r: request.Test) => r.set("Cookie", s.cookie).set("Origin", TEST_ORIGIN).set("X-CSRF-Token", s.csrfToken);
  return {
    app: theApp,
    company,
    user,
    session: s,
    get: (url: string) => request(theApp).get(url).set("Cookie", s.cookie),
    post: (url: string, body?: object) => withAuth(request(theApp).post(url)).send(body),
    patch: (url: string, body?: object) => withAuth(request(theApp).patch(url)).send(body),
    put: (url: string, body?: object) => withAuth(request(theApp).put(url)).send(body),
    upload: (url: string, data: Buffer, type: string, fileName?: string) => {
      const r = withAuth(request(theApp).post(url)).set("Content-Type", type);
      if (fileName) r.set("X-File-Name", encodeURIComponent(fileName));
      return r.send(data);
    },
  };
}
export type CompanySession = Awaited<ReturnType<typeof companySession>>;
