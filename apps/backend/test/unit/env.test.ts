import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv } from "../../src/config/env.js";

const valid = { DATABASE_URL: "postgres://user:s3cr3t@localhost:5432/blinka_dev" };

describe("parseEnv", () => {
  it("aplica valores por defecto seguros", () => {
    const env = parseEnv(valid);
    expect(env).toMatchObject({
      NODE_ENV: "development",
      PORT: 4000,
      JSON_BODY_LIMIT: "100kb",
      LOG_FORMAT: "json",
      DATABASE_SSL: "disable",
      WORKER_CONCURRENCY: 2,
      REMOTE_DB_CONFIRM: "",
    });
  });

  it("convierte números y trata cadenas vacías como ausentes", () => {
    const env = parseEnv({ ...valid, PORT: "5050", WORKER_CONCURRENCY: "", LOG_LEVEL: "" });
    expect(env.PORT).toBe(5050);
    expect(env.WORKER_CONCURRENCY).toBe(2);
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("exige DATABASE_URL", () => {
    expect(() => parseEnv({})).toThrowError(EnvValidationError);
    expect(() => parseEnv({})).toThrowError(/DATABASE_URL/);
  });

  it("rechaza URLs que no son postgres", () => {
    expect(() => parseEnv({ DATABASE_URL: "mysql://u:p@h/db" })).toThrowError(/DATABASE_URL/);
  });

  it("rechaza puertos y límites fuera de rango", () => {
    expect(() => parseEnv({ ...valid, PORT: "70000" })).toThrowError(/PORT/);
    expect(() => parseEnv({ ...valid, JSON_BODY_LIMIT: "lots" })).toThrowError(/JSON_BODY_LIMIT/);
    expect(() => parseEnv({ ...valid, WORKER_CONCURRENCY: "0" })).toThrowError(/WORKER_CONCURRENCY/);
  });

  it("no incluye valores recibidos (posibles secretos) en el mensaje de error", () => {
    try {
      parseEnv({ DATABASE_URL: "not-a-url-but-a-SECRET-value", PORT: "abc" });
      expect.unreachable();
    } catch (err) {
      expect(String(err)).not.toContain("SECRET");
      expect((err as EnvValidationError).issues.length).toBe(2);
    }
  });

  it("no permite logs 'pretty' en producción", () => {
    expect(() => parseEnv({ ...valid, NODE_ENV: "production", LOG_FORMAT: "pretty" })).toThrowError(/LOG_FORMAT/);
  });
});
