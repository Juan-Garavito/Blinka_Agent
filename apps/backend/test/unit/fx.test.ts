import { describe, expect, it, vi } from "vitest";
import { FixtureFxProvider, FrankfurterProvider, significantDigits } from "../../src/modules/fx/fx.providers.js";

const res = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "application/json" } });

describe("Frankfurter v2 (fetch simulado; la verificación real está en test/external)", () => {
  it("usa la fuente explícita por moneda y lee la tasa del texto JSON", async () => {
    const f = vi.fn().mockResolvedValue(res('{"date":"2026-10-16","base":"EUR","quote":"USD","rate":1.1253}'));
    const r = await new FrankfurterProvider(undefined, undefined, f).quote("EUR", "USD");
    expect(f.mock.calls[0]![0]).toBe("https://api.frankfurter.dev/v2/providers/ECB/rate/EUR/USD");
    expect(r).toEqual({ ok: true, quote: { rate: "1.1253", rateDate: "2026-10-16", providerReference: "frankfurter-v2:ECB:EUR/USD=1.1253@2026-10-16" } });
  });

  it("USD→COP con la TRM de BANREP sin pérdida de dígitos", async () => {
    const f = vi.fn().mockResolvedValue(res('{"date":"2026-10-16","base":"USD","quote":"COP","rate":3170.46}'));
    const r = await new FrankfurterProvider(undefined, undefined, f).quote("USD", "COP");
    expect(f.mock.calls[0]![0]).toBe("https://api.frankfurter.dev/v2/providers/BANREP/rate/USD/COP");
    expect(r).toMatchObject({ ok: true, quote: { rate: "3170.46" } });
  });

  it("COP→USD publicado con baja precisión (0.00032) → se invierte USD→COP con decimal exacto", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(res('{"date":"2026-10-16","base":"COP","quote":"USD","rate":0.00032}'))
      .mockResolvedValueOnce(res('{"date":"2026-10-16","base":"USD","quote":"COP","rate":3170.46}'));
    const r = await new FrankfurterProvider(undefined, undefined, f).quote("COP", "USD");
    expect(f.mock.calls[1]![0]).toBe("https://api.frankfurter.dev/v2/providers/BANREP/rate/USD/COP");
    expect(r).toEqual({
      ok: true,
      quote: { rate: "0.000315411644", rateDate: "2026-10-16", providerReference: "frankfurter-v2:BANREP:1/(USD/COP=3170.46)@2026-10-16;directo=0.00032" },
    });
  });

  it("inversión no fiable (fechas distintas o inversa igual de imprecisa) → sin tasa, nunca se inventa", async () => {
    const otherDate = vi
      .fn()
      .mockResolvedValueOnce(res('{"date":"2026-10-16","base":"COP","quote":"USD","rate":0.00032}'))
      .mockResolvedValueOnce(res('{"date":"2026-10-15","base":"USD","quote":"COP","rate":3170.46}'));
    expect(await new FrankfurterProvider(undefined, undefined, otherDate).quote("COP", "USD")).toEqual({ ok: false, reason: "INSUFFICIENT_PRECISION" });
  });

  it("sin fuente configurada para el par no se usa la tasa combinada", async () => {
    const f = vi.fn();
    expect(await new FrankfurterProvider(undefined, "COP:BANREP", f).quote("EUR", "USD")).toEqual({ ok: false, reason: "UNSUPPORTED_PAIR" });
    expect(f).not.toHaveBeenCalled();
  });

  it("caída, HTTP de error, 404, JSON inválido o par cruzado → no hay tasa", async () => {
    const q = (impl: () => Promise<Response>) => new FrankfurterProvider(undefined, undefined, vi.fn().mockImplementation(impl)).quote("EUR", "USD");
    expect(await q(() => Promise.reject(new Error("ECONNREFUSED")))).toEqual({ ok: false, reason: "PROVIDER_UNAVAILABLE" });
    expect(await q(() => Promise.resolve(res("x", 503)))).toEqual({ ok: false, reason: "PROVIDER_UNAVAILABLE" });
    expect(await q(() => Promise.resolve(res('{"message":"not found"}', 404)))).toEqual({ ok: false, reason: "UNSUPPORTED_PAIR" });
    expect(await q(() => Promise.resolve(res("<html>")))).toEqual({ ok: false, reason: "INVALID_RESPONSE" });
    expect(await q(() => Promise.resolve(res('{"date":"2026-10-16","base":"USD","quote":"EUR","rate":0.88}')))).toEqual({ ok: false, reason: "INVALID_RESPONSE" });
  });

  it("cuenta cifras significativas", () => {
    expect(significantDigits("0.00032")).toBe(2);
    expect(significantDigits("3170.46")).toBe(6);
    expect(significantDigits("1.1253")).toBe(5);
  });
});

describe("Fixture (SIMULADA)", () => {
  it("tasas fijas marcadas como simuladas; especificación inválida falla al arrancar", async () => {
    const f = new FixtureFxProvider("EUR:USD=1.0850,COP:USD=0.00024", () => "2026-10-18");
    expect(f.isSimulated).toBe(true);
    expect(f.name).toMatch(/SIMULADO/);
    expect(await f.quote("COP", "USD")).toEqual({ ok: true, quote: { rate: "0.00024", rateDate: "2026-10-18", providerReference: "fixture-local" } });
    expect((await f.quote("GBP", "USD")).ok).toBe(false);
    expect(() => new FixtureFxProvider("EUR-USD=1")).toThrow();
  });
});
