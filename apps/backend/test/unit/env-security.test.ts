import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/config/env.js";
import { buildSslOptions } from "../../src/shared/db/client.js";
import { assertLocalSeedTarget, assertSeedTarget } from "../../src/shared/db/seed-guard.js";

const local = { DATABASE_URL: "postgres://u:p@localhost:5432/db" };
const remote = "postgres://u:p@db.example.supabase.co:5432/postgres";

describe("TRUST_PROXY", () => {
  it("rechaza true (confiaría en cualquier X-Forwarded-For)", () => {
    expect(() => parseEnv({ ...local, TRUST_PROXY: "true" })).toThrow(/TRUST_PROXY/);
  });
  it("acepta false, número de saltos y listas IP/CIDR", () => {
    expect(parseEnv(local).TRUST_PROXY).toBe(false);
    expect(parseEnv({ ...local, TRUST_PROXY: "1" }).TRUST_PROXY).toBe(1);
    expect(parseEnv({ ...local, TRUST_PROXY: "loopback, 10.0.0.0/8" }).TRUST_PROXY).toEqual(["loopback", "10.0.0.0/8"]);
    expect(() => parseEnv({ ...local, TRUST_PROXY: "9" })).toThrow();
    expect(() => parseEnv({ ...local, TRUST_PROXY: "evil.example.com" })).toThrow();
  });
});

describe("TLS de PostgreSQL", () => {
  it("require cifra pero NO verifica; verify-full verifica identidad", () => {
    expect(buildSslOptions({ DATABASE_SSL: "disable" })).toBe(false);
    expect(buildSslOptions({ DATABASE_SSL: "require" })).toEqual({ rejectUnauthorized: false });
    expect(buildSslOptions({ DATABASE_SSL: "verify-full" })).toEqual({ rejectUnauthorized: true });
  });
  it("en producción, un host remoto exige verify-full", () => {
    const prod = { NODE_ENV: "production", ALLOWED_ORIGINS: "https://app.example.com", ACCOUNT_FINGERPRINT_SECRET: "x".repeat(40), FX_PROVIDER: "frankfurter", AI_PROVIDER: "gemini", GEMINI_API_KEY: "clave-ficticia-de-prueba" };
    expect(() => parseEnv({ ...prod, DATABASE_URL: remote, DATABASE_SSL: "require" })).toThrow(/verify-full/);
    expect(() => parseEnv({ ...prod, DATABASE_URL: local.DATABASE_URL, MIGRATION_DATABASE_URL: remote })).toThrow(/MIGRATION_DATABASE_URL/);
    expect(parseEnv({ ...prod, DATABASE_URL: remote, DATABASE_SSL: "verify-full" }).DATABASE_SSL).toBe("verify-full");
  });
  it("prohíbe sslmode en la URL para que no pise la configuración de verificación", () => {
    expect(() => parseEnv({ DATABASE_URL: `${remote}?sslmode=no-verify` })).toThrow(/sslmode/);
  });
});

describe("cookies y orígenes", () => {
  it("en producción exige cookies Secure y orígenes https", () => {
    expect(() => parseEnv({ ...local, NODE_ENV: "production", SESSION_COOKIE_SECURE: "false", ALLOWED_ORIGINS: "https://a.example" })).toThrow(/SESSION_COOKIE_SECURE/);
    expect(() => parseEnv({ ...local, NODE_ENV: "production" })).toThrow(/ALLOWED_ORIGINS/);
  });
  it("valida el formato de cada origen", () => {
    expect(() => parseEnv({ ...local, ALLOWED_ORIGINS: "https://a.example/ruta" })).toThrow(/ALLOWED_ORIGINS/);
    expect(parseEnv({ ...local, ALLOWED_ORIGINS: "https://a.example, http://localhost:5173" }).ALLOWED_ORIGINS).toEqual([
      "https://a.example",
      "http://localhost:5173",
    ]);
  });
});

describe("guardia del seed", () => {
  it("solo permite destinos locales fuera de producción", () => {
    expect(() => assertLocalSeedTarget(local.DATABASE_URL, "development")).not.toThrow();
    expect(() => assertLocalSeedTarget(remote, "development")).toThrow(/no es local/);
    expect(() => assertLocalSeedTarget(local.DATABASE_URL, "production")).toThrow(/production/);
  });
  it("remoto solo con SEED_REMOTE_CONFIRM exacto; nunca en producción", () => {
    expect(() => assertSeedTarget(remote, "development", "")).toThrow(/SEED_REMOTE_CONFIRM="db.example.supabase.co\/postgres"/);
    expect(() => assertSeedTarget(remote, "development", "otro/postgres")).toThrow(/no es local/);
    expect(assertSeedTarget(remote, "development", "db.example.supabase.co/postgres")).toEqual({ remote: true, remoteConfirm: "db.example.supabase.co/postgres" });
    expect(() => assertSeedTarget(remote, "production", "db.example.supabase.co/postgres")).toThrow(/production/);
    expect(assertSeedTarget(local.DATABASE_URL, "development")).toEqual({ remote: false, remoteConfirm: "" });
  });
});
