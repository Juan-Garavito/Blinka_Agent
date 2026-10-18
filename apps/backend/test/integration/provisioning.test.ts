import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_COMPANY_ID, identitySeedInput, seedIdentity } from "../../src/modules/identity/identity.seed.js";
import { verifyPassword } from "../../src/modules/identity/password.js";
import type { DbHandle } from "../../src/shared/db/client.js";
import { runAllMigrations } from "../../src/shared/db/run-migrations.js";
import { silentLogger } from "../helpers/env.js";
import { openTestDb, uniqueEmail } from "../helpers/identity.js";

describe("aprovisionamiento: seed local y registro auditable", () => {
  let db: DbHandle;
  const auditFile = path.join(tmpdir(), `blinka-audit-${process.pid}.jsonl`);

  beforeAll(async () => {
    db = await openTestDb();
  });
  afterAll(async () => {
    await db?.close();
    rmSync(auditFile, { force: true });
  });

  it("el seed es idempotente y no guarda la contraseña en claro", async () => {
    const input = identitySeedInput.parse({ SEED_EVALUATOR_EMAIL: uniqueEmail("evaluador"), SEED_EVALUATOR_PASSWORD: "Generada-Aleatoria-987" });
    const first = await seedIdentity(db.db, input);
    expect(first).toMatchObject({ companyId: DEMO_COMPANY_ID, userCreated: true, membershipCreated: true });
    const second = await seedIdentity(db.db, input);
    expect(second).toMatchObject({ companyCreated: false, userCreated: false, passwordUpdated: false, membershipCreated: false, userId: first.userId });

    const { rows } = await db.pool.query<{ password_hash: string }>("select password_hash from users where id = $1", [first.userId]);
    expect(rows[0]!.password_hash).not.toContain("Generada-Aleatoria-987");
    expect(await verifyPassword(rows[0]!.password_hash, "Generada-Aleatoria-987")).toBe(true);

    // Cambiar la contraseña en el entorno rota el hash; la empresa no cambia de moneda base.
    const rotated = await seedIdentity(db.db, { ...input, SEED_EVALUATOR_PASSWORD: "Otra-Generada-654321", SEED_COMPANY_BASE_CURRENCY: "EUR" });
    expect(rotated.passwordUpdated).toBe(true);
    const { rows: c } = await db.pool.query("select base_currency from companies where id = $1", [DEMO_COMPANY_ID]);
    expect(c[0]).toEqual({ base_currency: "USD" });
  });

  it("el seed exige secretos por entorno y rechaza contraseñas débiles o marcadores", () => {
    expect(identitySeedInput.safeParse({ SEED_EVALUATOR_EMAIL: "a@b.co" }).success).toBe(false);
    expect(identitySeedInput.safeParse({ SEED_EVALUATOR_EMAIL: "a@b.co", SEED_EVALUATOR_PASSWORD: "corta" }).success).toBe(false);
    expect(identitySeedInput.safeParse({ SEED_EVALUATOR_EMAIL: "a@b.co", SEED_EVALUATOR_PASSWORD: "changeme-please-123" }).success).toBe(false);
    expect(identitySeedInput.safeParse({ SEED_EVALUATOR_EMAIL: "a@b.co", SEED_EVALUATOR_PASSWORD: "x".repeat(16), SEED_COMPANY_TIMEZONE: "Mars/Base" }).success).toBe(false);
  });

  it("las migraciones registran intento y resultado; un destino remoto sin confirmación se rechaza y queda auditado", async () => {
    process.env.OPS_AUDIT_FILE = auditFile;
    try {
      const url = process.env.TEST_DATABASE_URL!;
      await runAllMigrations({ DATABASE_URL: url, DATABASE_SSL: "disable", REMOTE_DB_CONFIRM: "", NODE_ENV: "test" }, silentLogger);
      await expect(
        runAllMigrations(
          { DATABASE_URL: url, MIGRATION_DATABASE_URL: "postgres://admin:S3cret@db.example.supabase.co:5432/postgres", DATABASE_SSL: "disable", REMOTE_DB_CONFIRM: "", NODE_ENV: "test" },
          silentLogger,
        ),
      ).rejects.toThrow(/no es local/);
    } finally {
      delete process.env.OPS_AUDIT_FILE;
    }
    const lines = readFileSync(auditFile, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines.map((l) => [l.operation, l.phase, l.isLocal])).toEqual([
      ["migrate", "attempt", true],
      ["migrate", "success", true],
      ["migrate", "refused", false],
    ]);
    expect(lines[2]).toMatchObject({ host: "db.example.supabase.co", database: "postgres", remoteConfirmed: false });
    expect(readFileSync(auditFile, "utf8")).not.toContain("S3cret");
  });
});
