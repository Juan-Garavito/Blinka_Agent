import { z } from "zod";
import { D } from "../../shared/money.js";

export interface FxQuote {
  /** Tasa from→to como string decimal (nunca number). */
  rate: string;
  /** Fecha de publicación de la tasa (YYYY-MM-DD). */
  rateDate: string;
  providerReference: string | null;
}

export type FxQuoteResult = { ok: true; quote: FxQuote } | { ok: false; reason: "UNSUPPORTED_PAIR" | "PROVIDER_UNAVAILABLE" | "INVALID_RESPONSE" | "INSUFFICIENT_PRECISION" };

export interface FxProvider {
  readonly name: string;
  readonly isSimulated: boolean;
  quote(from: string, to: string): Promise<FxQuoteResult>;
}

/** Fuente por moneda (banco central publicado por Frankfurter v2). Formato: "COP:BANREP,EUR:ECB". */
export function parseFxSources(spec: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of spec.split(",").map((x) => x.trim()).filter(Boolean)) {
    const m = /^([A-Z]{3}):([A-Z0-9]{2,12})$/.exec(entry);
    if (!m) throw new Error(`FX_FRANKFURTER_SOURCES inválida: ${entry}`);
    map.set(m[1]!, m[2]!);
  }
  return map;
}

export const DEFAULT_FX_SOURCES = "COP:BANREP,EUR:ECB,GBP:ECB,MXN:ECB,CAD:ECB,BRL:ECB,CHF:ECB,JPY:ECB";

/** Cifras significativas de un decimal en texto ("0.00032" → 2, "3170.46" → 6). */
export function significantDigits(text: string): number {
  return text.replace(/^-/, "").replace(".", "").replace(/^0+/, "").replace(/e.*$/i, "").length;
}

const MIN_SIGNIFICANT_DIGITS = 5;

/**
 * Frankfurter **v2** (https://api.frankfurter.dev/v2) vía `fetch` nativo, sin credenciales.
 * - Fuente EXPLÍCITA por moneda (p. ej. COP→BANREP/TRM, EUR→BCE) mediante
 *   /v2/providers/{fuente}/rate/{base}/{quote}: nunca la tasa combinada de varios proveedores.
 * - La tasa se lee del TEXTO JSON (sin pasar por number de JavaScript).
 * - Si la cotización llega con < 5 cifras significativas (p. ej. COP→USD = "0.00032"),
 *   se pide el par inverso a la misma fuente y se invierte con aritmética decimal exacta.
 * ESTADO: verificado con GET reales el 18-10-2026 (evidencia en docs/implementation/evidence/frankfurter-v2-real.txt;
 * prueba de integración externa `npm run test:external`). La suite normal usa fetch simulado.
 */
export class FrankfurterProvider implements FxProvider {
  readonly name = "FRANKFURTER_V2";
  readonly isSimulated = false;
  private readonly sources: Map<string, string>;

  constructor(
    private readonly baseUrl = "https://api.frankfurter.dev/v2",
    sources: string = DEFAULT_FX_SOURCES,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.sources = parseFxSources(sources);
  }

  /** Fuente para el par: la de la moneda origen si está configurada, si no la de destino. */
  sourceFor(from: string, to: string): string | undefined {
    return this.sources.get(from) ?? this.sources.get(to);
  }

  private async fetchRate(source: string, base: string, quote: string): Promise<{ rate: string; date: string } | { error: "PROVIDER_UNAVAILABLE" | "INVALID_RESPONSE" | "UNSUPPORTED_PAIR" }> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/providers/${source}/rate/${base}/${quote}`, { signal: AbortSignal.timeout(8000) });
    } catch {
      return { error: "PROVIDER_UNAVAILABLE" };
    }
    if (res.status === 404 || res.status === 422) return { error: "UNSUPPORTED_PAIR" };
    if (!res.ok) return { error: "PROVIDER_UNAVAILABLE" };
    const text = await res.text().catch(() => "");
    // Tasa exacta tal como viene en el JSON (texto), y validación estructural del resto.
    const rateText = /"rate"\s*:\s*([0-9]+(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?)/.exec(text)?.[1];
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { error: "INVALID_RESPONSE" };
    }
    const parsed = z.object({ date: z.iso.date(), base: z.string(), quote: z.string(), rate: z.number().positive() }).safeParse(body);
    if (!parsed.success || !rateText || parsed.data.base !== base || parsed.data.quote !== quote) return { error: "INVALID_RESPONSE" };
    return { rate: new D(rateText).toFixed(), date: parsed.data.date };
  }

  async quote(from: string, to: string): Promise<FxQuoteResult> {
    const source = this.sourceFor(from, to);
    // Sin fuente configurada no se usa ninguna tasa combinada por defecto.
    if (!source) return { ok: false, reason: "UNSUPPORTED_PAIR" };
    const direct = await this.fetchRate(source, from, to);
    if ("error" in direct) return { ok: false, reason: direct.error };
    if (significantDigits(direct.rate) >= MIN_SIGNIFICANT_DIGITS) {
      return { ok: true, quote: { rate: direct.rate, rateDate: direct.date, providerReference: `frankfurter-v2:${source}:${from}/${to}=${direct.rate}@${direct.date}` } };
    }
    const inverse = await this.fetchRate(source, to, from);
    if ("error" in inverse || inverse.date !== direct.date || significantDigits(inverse.rate) <= significantDigits(direct.rate)) {
      return { ok: false, reason: "INSUFFICIENT_PRECISION" };
    }
    const rate = new D(1).div(inverse.rate).toDecimalPlaces(12).toFixed();
    return {
      ok: true,
      quote: { rate, rateDate: inverse.date, providerReference: `frankfurter-v2:${source}:1/(${to}/${from}=${inverse.rate})@${inverse.date};directo=${direct.rate}` },
    };
  }
}

/**
 * Tasas FIJAS de fixture: SOLO desarrollo local, pruebas y demo. Todas sus
 * tasas quedan con is_simulated = true y proveedor "FIXTURE (SIMULADO)".
 * Formato: "EUR:USD=1.08,COP:USD=0.00025".
 */
export class FixtureFxProvider implements FxProvider {
  readonly name = "FIXTURE (SIMULADO)";
  readonly isSimulated = true;
  private readonly rates: Map<string, string>;

  constructor(
    spec: string,
    private readonly rateDate: () => string = () => new Date().toISOString().slice(0, 10),
  ) {
    this.rates = new Map();
    for (const entry of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
      const m = /^([A-Z]{3}):([A-Z]{3})=(\d+(\.\d+)?)$/.exec(entry);
      if (!m) throw new Error(`FX_FIXTURE_RATES inválida: ${entry}`);
      this.rates.set(`${m[1]}:${m[2]}`, m[3]!);
    }
  }

  quote(from: string, to: string): Promise<FxQuoteResult> {
    const rate = this.rates.get(`${from}:${to}`);
    return Promise.resolve(
      rate ? { ok: true, quote: { rate, rateDate: this.rateDate(), providerReference: "fixture-local" } } : { ok: false, reason: "UNSUPPORTED_PAIR" },
    );
  }
}
