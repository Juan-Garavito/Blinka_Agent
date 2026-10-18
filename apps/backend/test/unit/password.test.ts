import { argon2Sync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MAX_PASSWORD_LENGTH, hashPassword, needsRehash, verifyPassword } from "../../src/modules/identity/password.js";

describe("Argon2id (node:crypto)", () => {
  it("la primitiva coincide con el vector de prueba oficial RFC 9106 §5.3 (Argon2id)", () => {
    const tag = argon2Sync("argon2id", {
      message: Buffer.alloc(32, 0x01),
      nonce: Buffer.alloc(16, 0x02),
      secret: Buffer.alloc(8, 0x03),
      associatedData: Buffer.alloc(12, 0x04),
      memory: 32,
      passes: 3,
      parallelism: 4,
      tagLength: 32,
    });
    expect(tag.toString("hex")).toBe("0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659");
  });

  it("produce un hash PHC argon2id con parámetros OWASP y sal aleatoria", async () => {
    const a = await hashPassword("una contraseña larga");
    const b = await hashPassword("una contraseña larga");
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain("una contraseña larga");
  });

  it("verifica la contraseña correcta y rechaza la incorrecta", async () => {
    const h = await hashPassword("correcta-123");
    expect(await verifyPassword(h, "correcta-123")).toBe(true);
    expect(await verifyPassword(h, "Correcta-123")).toBe(false);
    expect(await verifyPassword(h, "")).toBe(false);
  });

  it("trata hashes ilegibles o con parámetros abusivos como no coincidentes", async () => {
    expect(await verifyPassword("texto-plano", "texto-plano")).toBe(false);
    expect(await verifyPassword("$argon2id$v=19$m=99999999,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "x")).toBe(false);
  });

  it("limita la longitud para evitar abuso de CPU/memoria", async () => {
    await expect(hashPassword("x".repeat(MAX_PASSWORD_LENGTH + 1))).rejects.toThrow(RangeError);
    const h = await hashPassword("ok-pass");
    expect(await verifyPassword(h, "x".repeat(MAX_PASSWORD_LENGTH + 1))).toBe(false);
  });

  it("detecta hashes con parámetros desactualizados", async () => {
    const weak = await hashPassword("p", { memoryKiB: 1024, passes: 1, parallelism: 1 });
    expect(needsRehash(weak)).toBe(true);
    expect(needsRehash(await hashPassword("p"))).toBe(false);
  });
});
