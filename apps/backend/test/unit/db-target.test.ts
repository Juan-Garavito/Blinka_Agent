import { describe, expect, it } from "vitest";
import {
  UnsafeDbTargetError,
  assertSafeDbTarget,
  describeDbTarget,
  formatDbTarget,
} from "../../src/shared/db/target.js";
import { assertTestDatabaseUrl } from "../../src/shared/db/test-database.js";

const remote = "postgresql://postgres.abc:SuperSecret@aws-0-eu.pooler.supabase.com:5432/postgres";

describe("destino de base de datos", () => {
  it("describe el destino sin credenciales", () => {
    const t = describeDbTarget(remote);
    expect(t).toEqual({ host: "aws-0-eu.pooler.supabase.com", port: "5432", database: "postgres", isLocal: false });
    expect(formatDbTarget(t)).not.toContain("SuperSecret");
    expect(formatDbTarget(t)).toContain("REMOTO");
  });

  it.each(["localhost", "127.0.0.1", "postgres"])("acepta el host local %s", (host) => {
    expect(assertSafeDbTarget(`postgres://u:p@${host}:5432/db`, "", "migrate").isLocal).toBe(true);
  });

  it("rechaza un destino remoto sin confirmación expresa y sin filtrar el secreto", () => {
    expect(() => assertSafeDbTarget(remote, "", "migrate")).toThrowError(UnsafeDbTargetError);
    try {
      assertSafeDbTarget(remote, "yes", "migrate");
    } catch (err) {
      expect(String(err)).toContain('REMOTE_DB_CONFIRM="aws-0-eu.pooler.supabase.com/postgres"');
      expect(String(err)).not.toContain("SuperSecret");
    }
  });

  it("acepta un destino remoto solo con la confirmación exacta host/base", () => {
    expect(assertSafeDbTarget(remote, "aws-0-eu.pooler.supabase.com/postgres", "migrate").isLocal).toBe(false);
    expect(() => assertSafeDbTarget(remote, "aws-0-eu.pooler.supabase.com/otra", "migrate")).toThrowError();
  });

  it("la base de pruebas debe ser local y terminar en _test", () => {
    expect(assertTestDatabaseUrl("postgres://u:p@127.0.0.1:54329/blinka_test")).toBeTruthy();
    expect(() => assertTestDatabaseUrl("postgres://u:p@127.0.0.1:54329/blinka_dev")).toThrowError();
    expect(() => assertTestDatabaseUrl(remote.replace("/postgres", "/x_test"))).toThrowError();
    expect(() => assertTestDatabaseUrl(undefined)).toThrowError();
  });
});
