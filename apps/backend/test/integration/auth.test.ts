import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashSessionToken } from "../../src/modules/identity/auth.service.js";
import type { DbHandle } from "../../src/shared/db/client.js";
import {
  TEST_ORIGIN,
  TEST_PASSWORD,
  addMembership,
  createCompany,
  createUser,
  login,
  makeTestApp,
  openTestDb,
  sessionCookieFrom,
  uniqueEmail,
} from "../helpers/identity.js";

describe("autenticación con sesiones en PostgreSQL", () => {
  let db: DbHandle;
  beforeAll(async () => {
    db = await openTestDb();
  });
  afterAll(async () => {
    await db?.close();
  });

  const setup = async () => {
    const company = await createCompany(db);
    const user = await createUser(db);
    await addMembership(db, company.id, user.id);
    return { company, user, app: makeTestApp(db) };
  };

  describe("login", () => {
    it("login correcto: cookie HttpOnly/Secure/SameSite=Strict con prefijo __Host- y sesión persistida", async () => {
      const { user, company, app } = await setup();
      const res = await request(app).post("/api/auth/login").set("Origin", TEST_ORIGIN).send({ email: user.email, password: TEST_PASSWORD });
      expect(res.status).toBe(200);
      const setCookie = (res.headers["set-cookie"] as unknown as string[])[0]!;
      expect(setCookie).toMatch(/^__Host-blinka_session=[A-Za-z0-9_-]{43};/);
      expect(setCookie).toMatch(/HttpOnly/);
      expect(setCookie).toMatch(/Secure/);
      expect(setCookie).toMatch(/SameSite=Strict/);
      expect(setCookie).toMatch(/Path=\//);
      expect(setCookie).not.toMatch(/Domain=/);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.body).toMatchObject({ user: { id: user.id, email: user.email }, companies: [{ id: company.id }] });
      expect(res.body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

      // La BD guarda el SHA-256 del token, nunca el token de la cookie.
      const token = sessionCookieFrom(res)!.split("=")[1]!;
      const { rows } = await db.pool.query("select token_hash from auth_sessions where user_id = $1", [user.id]);
      expect(rows).toEqual([{ token_hash: hashSessionToken(token) }]);
      expect(JSON.stringify(rows)).not.toContain(token);
    });

    it("el correo se normaliza (mayúsculas y espacios)", async () => {
      const { user, app } = await setup();
      const res = await request(app)
        .post("/api/auth/login")
        .set("Origin", TEST_ORIGIN)
        .send({ email: `  ${user.email.toUpperCase()} `, password: TEST_PASSWORD });
      expect(res.status).toBe(200);
    });

    it("contraseña incorrecta, correo inexistente y usuario inactivo dan el MISMO error 401 sin cookie", async () => {
      const { user, app } = await setup();
      const inactive = await createUser(db, { active: false });
      const attempts = [
        { email: user.email, password: "incorrecta-123" },
        { email: uniqueEmail("nadie"), password: TEST_PASSWORD },
        { email: inactive.email, password: TEST_PASSWORD },
      ];
      const bodies = [];
      for (const a of attempts) {
        const res = await request(app).post("/api/auth/login").set("Origin", TEST_ORIGIN).send(a);
        expect(res.status).toBe(401);
        expect(res.headers["set-cookie"]).toBeUndefined();
        bodies.push({ code: res.body.error.code, message: res.body.error.message });
      }
      expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
      expect(bodies[0]).toEqual({ code: "INVALID_CREDENTIALS", message: "Correo o contraseña incorrectos" });
    });

    it("valida el cuerpo y no acepta campos extra", async () => {
      const { app } = await setup();
      const res = await request(app).post("/api/auth/login").set("Origin", TEST_ORIGIN).send({ email: "no-es-correo", password: "" });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain("password\":\"");
      const extra = await request(app).post("/api/auth/login").set("Origin", TEST_ORIGIN).send({ email: uniqueEmail(), password: "x", companyId: "a" });
      expect(extra.status).toBe(400);
    });

    it("las contraseñas se almacenan como hash Argon2id", async () => {
      const { user } = await setup();
      const { rows } = await db.pool.query<{ password_hash: string }>("select password_hash from users where id = $1", [user.id]);
      expect(rows[0]!.password_hash).toMatch(/^\$argon2id\$v=19\$/);
      expect(rows[0]!.password_hash).not.toContain(TEST_PASSWORD);
    });
  });

  describe("sesión", () => {
    it("acceso denegado sin sesión y con cookie inválida (que además se borra)", async () => {
      const { app } = await setup();
      const none = await request(app).get("/api/auth/session");
      expect(none.status).toBe(401);
      expect(none.body.error.code).toBe("UNAUTHENTICATED");
      const forged = await request(app).get("/api/auth/session").set("Cookie", `__Host-blinka_session=${"x".repeat(43)}`);
      expect(forged.status).toBe(401);
      expect(String(forged.headers["set-cookie"])).toMatch(/__Host-blinka_session=;.*Expires=Thu, 01 Jan 1970/);
    });

    it("GET /api/auth/session devuelve el usuario y el token CSRF de la sesión", async () => {
      const { user, app } = await setup();
      const s = await login(app, user.email);
      const res = await request(app).get("/api/auth/session").set("Cookie", s.cookie);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ user: { id: user.id }, csrfToken: s.csrfToken });
      expect(res.headers["cache-control"]).toBe("no-store");
    });

    it("regenera el identificador al iniciar sesión: la sesión anterior queda revocada (anti session fixation)", async () => {
      const { user, app } = await setup();
      const first = await login(app, user.email);
      const res = await request(app)
        .post("/api/auth/login")
        .set("Origin", TEST_ORIGIN)
        .set("Cookie", first.cookie)
        .set("X-CSRF-Token", first.csrfToken)
        .send({ email: user.email, password: TEST_PASSWORD });
      expect(res.status).toBe(200);
      const second = sessionCookieFrom(res)!;
      expect(second).not.toBe(first.cookie);
      expect((await request(app).get("/api/auth/session").set("Cookie", first.cookie)).status).toBe(401);
      expect((await request(app).get("/api/auth/session").set("Cookie", second)).status).toBe(200);
      const { rows } = await db.pool.query("select revoked_reason from auth_sessions where user_id = $1 order by created_at", [user.id]);
      expect(rows).toEqual([{ revoked_reason: "REGENERATED" }, { revoked_reason: null }]);
    });

    it("logout revoca la sesión en BD y borra la cookie; reutilizar la cookie falla", async () => {
      const { user, app } = await setup();
      const s = await login(app, user.email);
      const out = await request(app).post("/api/auth/logout").set("Origin", TEST_ORIGIN).set("Cookie", s.cookie).set("X-CSRF-Token", s.csrfToken);
      expect(out.status).toBe(204);
      expect(String(out.headers["set-cookie"])).toMatch(/__Host-blinka_session=;/);
      expect((await request(app).get("/api/auth/session").set("Cookie", s.cookie)).status).toBe(401);
      const { rows } = await db.pool.query("select revoked_at is not null as revoked, revoked_reason from auth_sessions where user_id = $1", [user.id]);
      expect(rows).toEqual([{ revoked: true, revoked_reason: "LOGOUT" }]);
    });

    it("expiración absoluta: SESSION_EXPIRED", async () => {
      const { user, app } = await setup();
      const s = await login(app, user.email);
      await db.pool.query(
        "update auth_sessions set created_at = now() - interval '13 hours', expires_at = now() - interval '1 hour' where user_id = $1",
        [user.id],
      );
      const res = await request(app).get("/api/auth/session").set("Cookie", s.cookie);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("SESSION_EXPIRED");
    });

    it("expiración por inactividad (reloj inyectado): SESSION_EXPIRED", async () => {
      const { user } = await setup();
      let now = new Date();
      const app = makeTestApp(db, { env: { SESSION_IDLE_TIMEOUT_MINUTES: 30 }, now: () => now });
      const s = await login(app, user.email);
      now = new Date(now.getTime() + 29 * 60_000);
      expect((await request(app).get("/api/auth/session").set("Cookie", s.cookie)).status).toBe(200); // renueva last_seen_at
      now = new Date(now.getTime() + 29 * 60_000);
      expect((await request(app).get("/api/auth/session").set("Cookie", s.cookie)).status).toBe(200);
      now = new Date(now.getTime() + 31 * 60_000);
      const res = await request(app).get("/api/auth/session").set("Cookie", s.cookie);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("SESSION_EXPIRED");
    });

    it("desactivar al usuario invalida sus sesiones existentes", async () => {
      const { user, app } = await setup();
      const s = await login(app, user.email);
      await db.pool.query("update users set active = false where id = $1", [user.id]);
      expect((await request(app).get("/api/auth/session").set("Cookie", s.cookie)).status).toBe(401);
    });
  });

  describe("CSRF y origen", () => {
    const logout = (app: ReturnType<typeof makeTestApp>, s: { cookie: string }) =>
      request(app).post("/api/auth/logout").set("Cookie", s.cookie);

    it("sin token CSRF o con token incorrecto → 403 y la sesión sigue activa", async () => {
      const { user, app } = await setup();
      const s = await login(app, user.email);
      const missing = await logout(app, s).set("Origin", TEST_ORIGIN);
      expect(missing.status).toBe(403);
      expect(missing.body.error.code).toBe("CSRF_TOKEN_INVALID");
      const wrong = await logout(app, s).set("Origin", TEST_ORIGIN).set("X-CSRF-Token", "x".repeat(43));
      expect(wrong.status).toBe(403);
      // El token de OTRA sesión tampoco sirve.
      const other = await login(app, (await (async () => {
        const u = await createUser(db);
        return u;
      })()).email);
      expect((await logout(app, s).set("Origin", TEST_ORIGIN).set("X-CSRF-Token", other.csrfToken)).status).toBe(403);
      expect((await request(app).get("/api/auth/session").set("Cookie", s.cookie)).status).toBe(200);
    });

    it("Origin no permitido → 403 incluso con token válido; también en login", async () => {
      const { user, app } = await setup();
      const s = await login(app, user.email);
      const res = await logout(app, s).set("Origin", "https://evil.example").set("X-CSRF-Token", s.csrfToken);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("CSRF_ORIGIN_REJECTED");
      const loginEvil = await request(app).post("/api/auth/login").set("Origin", "https://evil.example").send({ email: user.email, password: TEST_PASSWORD });
      expect(loginEvil.status).toBe(403);
      expect(loginEvil.headers["set-cookie"]).toBeUndefined();
    });

    it("Sec-Fetch-Site=cross-site sin Origin → 403", async () => {
      const { user, app } = await setup();
      const res = await request(app).post("/api/auth/login").set("Sec-Fetch-Site", "cross-site").send({ email: user.email, password: TEST_PASSWORD });
      expect(res.status).toBe(403);
    });

    it("un formulario HTML (urlencoded) no es aceptado → 415", async () => {
      const { user, app } = await setup();
      const res = await request(app)
        .post("/api/auth/login")
        .set("Origin", TEST_ORIGIN)
        .type("form")
        .send({ email: user.email, password: TEST_PASSWORD });
      expect(res.status).toBe(415);
    });

    it("métodos seguros (GET) no requieren token CSRF", async () => {
      const { user, app } = await setup();
      const s = await login(app, user.email);
      expect((await request(app).get("/api/auth/session").set("Cookie", s.cookie).set("Origin", "https://evil.example")).status).toBe(200);
    });
  });

  describe("rate limiting del login (contadores en PostgreSQL)", () => {
    it("por cuenta: tras N fallos se bloquea con 429, incluso con la contraseña correcta", async () => {
      const { user } = await setup();
      const app = makeTestApp(db, { env: { LOGIN_RATE_LIMIT_PER_ACCOUNT: 3 } });
      for (let i = 0; i < 3; i++) {
        const r = await request(app).post("/api/auth/login").set("Origin", TEST_ORIGIN).send({ email: user.email, password: `mala-${i}` });
        expect(r.status).toBe(401);
      }
      const blocked = await request(app).post("/api/auth/login").set("Origin", TEST_ORIGIN).send({ email: user.email, password: TEST_PASSWORD });
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe("RATE_LIMITED");
      expect(blocked.headers["set-cookie"]).toBeUndefined();
      // Otra cuenta no queda afectada.
      const other = await createUser(db);
      expect((await request(app).post("/api/auth/login").set("Origin", TEST_ORIGIN).send({ email: other.email, password: TEST_PASSWORD })).status).toBe(200);
    });

    it("el contador es compartido entre instancias de la API (misma BD)", async () => {
      const { user } = await setup();
      const a = makeTestApp(db, { env: { LOGIN_RATE_LIMIT_PER_ACCOUNT: 2 } });
      const b = makeTestApp(db, { env: { LOGIN_RATE_LIMIT_PER_ACCOUNT: 2 } });
      await request(a).post("/api/auth/login").set("Origin", TEST_ORIGIN).send({ email: user.email, password: "mala-1" });
      await request(b).post("/api/auth/login").set("Origin", TEST_ORIGIN).send({ email: user.email, password: "mala-2" });
      const third = await request(a).post("/api/auth/login").set("Origin", TEST_ORIGIN).send({ email: user.email, password: "mala-3" });
      expect(third.status).toBe(429);
    });

    it("por IP con proxy de confianza: X-Forwarded-For solo se respeta si TRUST_PROXY lo permite", async () => {
      const ipA = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
      const trusted = makeTestApp(db, { trustProxy: ["loopback"], env: { LOGIN_RATE_LIMIT_PER_IP: 2 } });
      const send = (app: typeof trusted, ip: string) =>
        request(app).post("/api/auth/login").set("Origin", TEST_ORIGIN).set("X-Forwarded-For", ip).send({ email: uniqueEmail(), password: "x" });
      expect((await send(trusted, ipA)).status).toBe(401);
      expect((await send(trusted, ipA)).status).toBe(401);
      expect((await send(trusted, ipA)).status).toBe(429);
      // Otra IP real (vía proxy de confianza) tiene su propio contador.
      expect((await send(trusted, "198.51.100.7")).status).toBe(401);

      // Sin proxy de confianza, falsificar X-Forwarded-For no evade el límite: cuenta la IP del socket.
      await db.pool.query("delete from rate_limit_buckets where key like 'login-ip:%'");
      const untrusted = makeTestApp(db, { env: { LOGIN_RATE_LIMIT_PER_IP: 2 } });
      expect((await send(untrusted, "192.0.2.1")).status).toBe(401);
      expect((await send(untrusted, "192.0.2.2")).status).toBe(401);
      expect((await send(untrusted, "192.0.2.3")).status).toBe(429);
      await db.pool.query("delete from rate_limit_buckets where key like 'login-ip:%'");
    });
  });
});
