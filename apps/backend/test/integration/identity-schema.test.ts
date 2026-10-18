import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/shared/db/client.js";
import { addMembership, createCompany, createUser, openTestDb, uniqueEmail } from "../helpers/identity.js";

/** Ejecuta SQL esperando un error de PostgreSQL y devuelve su código y restricción. */
async function pgError(db: DbHandle, sql: string, params: unknown[] = []) {
  try {
    await db.pool.query(sql, params);
  } catch (err) {
    const e = err as { code?: string; constraint?: string };
    return { code: e.code, constraint: e.constraint };
  }
  throw new Error(`Se esperaba un error para: ${sql}`);
}

const HASH = "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("migraciones de identidad: restricciones e índices", () => {
  let db: DbHandle;
  beforeAll(async () => {
    db = await openTestDb();
  });
  afterAll(async () => {
    await db?.close();
  });

  it("crea las tablas e índices esperados", async () => {
    const { rows } = await db.pool.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public'
         and tablename in ('companies','users','company_users','auth_sessions','rate_limit_buckets') order by 1`,
    );
    expect(rows.map((r) => r.indexname)).toEqual(
      expect.arrayContaining([
        "auth_sessions_expires_at_idx",
        "auth_sessions_pkey",
        "auth_sessions_token_hash_key",
        "auth_sessions_user_id_idx",
        "companies_pkey",
        "company_users_pkey",
        "company_users_user_id_idx",
        "rate_limit_buckets_pkey",
        "users_email_key",
        "users_pkey",
      ]),
    );
  });

  it("companies: moneda ISO 4217 en mayúsculas, estado válido, nombre no vacío", async () => {
    const ins = "insert into companies (name, base_currency, timezone, status) values ($1, $2, $3, $4)";
    expect(await pgError(db, ins, ["X", "usd", "UTC", "ACTIVE"])).toMatchObject({ code: "23514", constraint: "companies_base_currency_iso4217" });
    expect(await pgError(db, ins, ["X", "US", "UTC", "ACTIVE"])).toMatchObject({ code: "23514" });
    expect(await pgError(db, ins, ["X", "USD", "UTC", "DELETED"])).toMatchObject({ constraint: "companies_status_valid" });
    expect(await pgError(db, ins, ["  ", "USD", "UTC", "ACTIVE"])).toMatchObject({ constraint: "companies_name_not_blank" });
  });

  it("companies: la zona horaria debe ser reconocida por PostgreSQL (trigger)", async () => {
    const ins = "insert into companies (name, base_currency, timezone) values ('X', 'USD', $1)";
    expect(await pgError(db, ins, ["Mars/Olympus"])).toMatchObject({ code: "23514", constraint: "companies_timezone_valid" });
    expect(await pgError(db, ins, [" UTC"])).toMatchObject({ code: "23514" });
    const c = await createCompany(db, { timezone: "Europe/Madrid" });
    expect(await pgError(db, "update companies set timezone = 'No/Existe' where id = $1", [c.id])).toMatchObject({ code: "23514" });
  });

  it("users: correo único y normalizado; el hash debe ser Argon2id (nunca texto plano)", async () => {
    const email = uniqueEmail();
    await db.pool.query("insert into users (email, password_hash) values ($1, $2)", [email, HASH]);
    const ins = "insert into users (email, password_hash) values ($1, $2)";
    expect(await pgError(db, ins, [email, HASH])).toMatchObject({ code: "23505", constraint: "users_email_key" });
    expect(await pgError(db, ins, [email.toUpperCase(), HASH])).toMatchObject({ constraint: "users_email_normalized" });
    expect(await pgError(db, ins, ["sin-arroba", HASH])).toMatchObject({ constraint: "users_email_normalized" });
    expect(await pgError(db, ins, [uniqueEmail(), "contraseña-en-claro"])).toMatchObject({ constraint: "users_password_hash_argon2id" });
  });

  it("company_users: unicidad (company_id, user_id) e integridad referencial", async () => {
    const c = await createCompany(db);
    const u = await createUser(db);
    await addMembership(db, c.id, u.id);
    const ins = "insert into company_users (company_id, user_id) values ($1, $2)";
    expect(await pgError(db, ins, [c.id, u.id])).toMatchObject({ code: "23505", constraint: "company_users_pkey" });
    expect(await pgError(db, ins, [randomUUID(), u.id])).toMatchObject({ code: "23503" });
    expect(await pgError(db, ins, [c.id, randomUUID()])).toMatchObject({ code: "23503" });
    // ON DELETE RESTRICT: no se puede borrar una empresa con membresías.
    expect(await pgError(db, "delete from companies where id = $1", [c.id])).toMatchObject({ code: "23503" });
  });

  it("auth_sessions: hash de token hex de 64, unicidad, expiración posterior y revocación coherente", async () => {
    const u = await createUser(db);
    const ins = `insert into auth_sessions (token_hash, user_id, csrf_token, expires_at, revoked_at, revoked_reason)
                 values ($1, $2, 'c', $3, $4, $5)`;
    const future = new Date(Date.now() + 3_600_000);
    const hex = () => randomBytes(32).toString("hex");
    const hash = hex();
    await db.pool.query(ins, [hash, u.id, future, null, null]);
    expect(await pgError(db, ins, [hash, u.id, future, null, null])).toMatchObject({ code: "23505", constraint: "auth_sessions_token_hash_key" });
    expect(await pgError(db, ins, ["token-en-claro", u.id, future, null, null])).toMatchObject({ constraint: "auth_sessions_token_hash_hex" });
    expect(await pgError(db, ins, [hex(), u.id, new Date(Date.now() - 1000), null, null])).toMatchObject({
      constraint: "auth_sessions_expiry_after_creation",
    });
    expect(await pgError(db, ins, [hex(), u.id, future, new Date(), null])).toMatchObject({ constraint: "auth_sessions_revocation_consistent" });
    expect(await pgError(db, ins, [hex(), u.id, future, new Date(), "HACKED"])).toMatchObject({ constraint: "auth_sessions_revocation_consistent" });
  });
});
