import { describe, expect, it } from "vitest";
import { FrankfurterProvider } from "../../src/modules/fx/fx.providers.js";

/**
 * Prueba de integración EXTERNA (red real, sin credenciales). No forma parte de
 * `npm test`; se ejecuta con `npm run test:external`. Los valores cambian a
 * diario: se comprueban estructura, fuente, rangos plausibles, coherencia del
 * par inverso y frescura, no importes exactos.
 */
const provider = new FrankfurterProvider();
const ageDays = (d: string) => (Date.now() - new Date(`${d}T00:00:00Z`).getTime()) / 86_400_000;

describe("Frankfurter v2 real", () => {
  it("USD/COP (BANREP, TRM)", async () => {
    const r = await provider.quote("USD", "COP");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quote.providerReference).toMatch(/^frankfurter-v2:BANREP:USD\/COP=/);
    expect(Number(r.quote.rate)).toBeGreaterThan(1000);
    expect(Number(r.quote.rate)).toBeLessThan(10000);
    expect(ageDays(r.quote.rateDate)).toBeLessThan(5);
  });

  it("COP/USD por inversión exacta, coherente con USD/COP", async () => {
    const [cu, uc] = await Promise.all([provider.quote("COP", "USD"), provider.quote("USD", "COP")]);
    expect(cu.ok && uc.ok).toBe(true);
    if (!cu.ok || !uc.ok) return;
    expect(cu.quote.providerReference).toMatch(/BANREP:1\/\(USD\/COP=/);
    expect(Math.abs(Number(cu.quote.rate) * Number(uc.quote.rate) - 1)).toBeLessThan(1e-9);
  });

  it("EUR/USD (BCE)", async () => {
    const r = await provider.quote("EUR", "USD");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quote.providerReference).toMatch(/^frankfurter-v2:ECB:EUR\/USD=/);
    expect(Number(r.quote.rate)).toBeGreaterThan(0.5);
    expect(Number(r.quote.rate)).toBeLessThan(2);
    expect(ageDays(r.quote.rateDate)).toBeLessThan(5);
  });
});
