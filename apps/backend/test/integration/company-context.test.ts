import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/shared/db/client.js";
import { addMembership, createCompany, createUser, login, makeTestApp, openTestDb } from "../helpers/identity.js";

describe("contexto empresarial y aislamiento entre empresas", () => {
  let db: DbHandle;
  let app: ReturnType<typeof makeTestApp>;
  let companyA: Awaited<ReturnType<typeof createCompany>>;
  let companyB: Awaited<ReturnType<typeof createCompany>>;
  let userA: Awaited<ReturnType<typeof createUser>>;
  let userB: Awaited<ReturnType<typeof createUser>>;

  beforeAll(async () => {
    db = await openTestDb();
    app = makeTestApp(db);
    companyA = await createCompany(db, { name: "Alfa Ficticia", baseCurrency: "USD", timezone: "America/Bogota" });
    companyB = await createCompany(db, { name: "Beta Ficticia", baseCurrency: "EUR", timezone: "Europe/Madrid" });
    userA = await createUser(db);
    userB = await createUser(db);
    await addMembership(db, companyA.id, userA.id);
    await addMembership(db, companyB.id, userB.id);
  });
  afterAll(async () => {
    await db?.close();
  });

  const current = (cookie: string, companyId?: string) => {
    const r = request(app).get("/api/companies/current").set("Cookie", cookie);
    return companyId ? r.set("X-Company-Id", companyId) : r;
  };

  it("requiere sesión", async () => {
    expect((await request(app).get("/api/companies/current")).status).toBe(401);
  });

  it("resuelve la empresa desde la membresía, con moneda base y zona horaria", async () => {
    const s = await login(app, userA.email);
    const res = await current(s.cookie);
    expect(res.status).toBe(200);
    expect(res.body.company).toEqual({ id: companyA.id, name: "Alfa Ficticia", baseCurrency: "USD", timezone: "America/Bogota" });
    expect(s.body.companies.map((c) => c.id)).toEqual([companyA.id]);
  });

  it("aislamiento: cada usuario ve solo su empresa; el company_id ajeno enviado por el cliente se rechaza", async () => {
    const sA = await login(app, userA.email);
    const sB = await login(app, userB.email);
    expect((await current(sB.cookie)).body.company.id).toBe(companyB.id);

    const crossA = await current(sA.cookie, companyB.id);
    expect(crossA.status).toBe(403);
    expect(crossA.body.error.code).toBe("COMPANY_ACCESS_DENIED");
    expect(JSON.stringify(crossA.body)).not.toContain("Beta");
    expect((await current(sB.cookie, companyA.id)).status).toBe(403);
  });

  it("empresa inexistente y empresa ajena son indistinguibles; id malformado → 400", async () => {
    const s = await login(app, userA.email);
    const ghost = await current(s.cookie, randomUUID());
    const foreign = await current(s.cookie, companyB.id);
    expect(ghost.status).toBe(403);
    expect(ghost.body.error.code).toBe(foreign.body.error.code);
    expect(ghost.body.error.message).toBe(foreign.body.error.message);
    expect((await current(s.cookie, "1 or 1=1")).status).toBe(400);
  });

  it("usuario con dos membresías debe elegir; cada selección se valida", async () => {
    const both = await createUser(db);
    await addMembership(db, companyA.id, both.id);
    await addMembership(db, companyB.id, both.id);
    const s = await login(app, both.email);
    expect(s.body.companies).toHaveLength(2);
    const none = await current(s.cookie);
    expect(none.status).toBe(400);
    expect(none.body.error.code).toBe("COMPANY_SELECTION_REQUIRED");
    expect((await current(s.cookie, companyA.id)).body.company.id).toBe(companyA.id);
    expect((await current(s.cookie, companyB.id)).body.company.id).toBe(companyB.id);
  });

  it("membresía inactiva o empresa inactiva → sin acceso", async () => {
    const company = await createCompany(db);
    const u = await createUser(db);
    await addMembership(db, company.id, u.id, false);
    const s = await login(app, u.email);
    expect(s.body.companies).toEqual([]);
    expect((await current(s.cookie)).body.error.code).toBe("NO_COMPANY_ACCESS");
    expect((await current(s.cookie, company.id)).status).toBe(403);

    const c2 = await createCompany(db);
    const u2 = await createUser(db);
    await addMembership(db, c2.id, u2.id);
    const s2 = await login(app, u2.email);
    await db.pool.query("update companies set status = 'INACTIVE' where id = $1", [c2.id]);
    expect((await current(s2.cookie)).status).toBe(403);
    expect((await current(s2.cookie, c2.id)).status).toBe(403);
  });

  it("revocar la membresía tiene efecto inmediato en sesiones ya abiertas", async () => {
    const c = await createCompany(db);
    const u = await createUser(db);
    await addMembership(db, c.id, u.id);
    const s = await login(app, u.email);
    expect((await current(s.cookie)).status).toBe(200);
    await db.pool.query("update company_users set active = false where company_id = $1 and user_id = $2", [c.id, u.id]);
    expect((await current(s.cookie)).status).toBe(403);
  });
});
