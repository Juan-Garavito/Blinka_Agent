import { and, desc, eq, gt } from "drizzle-orm";
import type { Database } from "../../shared/db/client.js";
import type { Logger } from "../../shared/logger.js";
import { fxRateSnapshots } from "./fx.schema.js";
import type { FxProvider } from "./fx.providers.js";

export type FxSnapshot = typeof fxRateSnapshots.$inferSelect;

export type FxResolution =
  | { status: "OK"; snapshot: FxSnapshot }
  | { status: "UNAVAILABLE"; reason: string; from: string; to: string };

export interface FxConfig {
  /** Antigüedad máxima aceptada de una tasa (cubre fines de semana/feriados del proveedor). */
  maxAgeHours: number;
  /** Reutilizar un snapshot del mismo par consultado hace menos de N minutos. */
  reuseMinutes: number;
}

/**
 * Servicio FX del backend (ER §G, ARCH §8): lo invoca el motor financiero,
 * nunca un agente. Persiste cada tasa en fx_rate_snapshots y valida su frescura.
 * Sin tasa válida → UNAVAILABLE (el motor producirá ERROR recuperable).
 */
export function createFxService(deps: { db: Database; provider: FxProvider; logger: Logger; config: FxConfig; now?: () => Date }) {
  const { db, provider, logger, config } = deps;
  const now = deps.now ?? (() => new Date());

  return {
    providerName: provider.name,

    async resolve(from: string, to: string): Promise<FxResolution> {
      const at = now();
      if (from === to) {
        const [identity] = await db
          .insert(fxRateSnapshots)
          .values({ fromCurrency: from, toCurrency: to, rate: "1", provider: "IDENTITY", rateDate: at.toISOString().slice(0, 10), rateTimestamp: at, fetchedAt: at, validUntil: new Date(at.getTime() + 86_400_000), isSimulated: false })
          .returning();
        return { status: "OK", snapshot: identity! };
      }

      const reuseAfter = new Date(at.getTime() - config.reuseMinutes * 60_000);
      const [recent] = await db
        .select()
        .from(fxRateSnapshots)
        .where(and(eq(fxRateSnapshots.fromCurrency, from), eq(fxRateSnapshots.toCurrency, to), eq(fxRateSnapshots.provider, provider.name), gt(fxRateSnapshots.fetchedAt, reuseAfter), gt(fxRateSnapshots.validUntil, at)))
        .orderBy(desc(fxRateSnapshots.fetchedAt))
        .limit(1);
      if (recent) return { status: "OK", snapshot: recent };

      const result = await provider.quote(from, to);
      if (!result.ok) {
        logger.warn({ from, to, provider: provider.name, reason: result.reason }, "Tasa FX no disponible");
        return { status: "UNAVAILABLE", reason: result.reason, from, to };
      }
      const rateTimestamp = new Date(`${result.quote.rateDate}T16:00:00Z`);
      const validUntil = new Date(rateTimestamp.getTime() + config.maxAgeHours * 3_600_000);
      if (validUntil.getTime() <= at.getTime()) {
        logger.warn({ from, to, rateDate: result.quote.rateDate }, "Tasa FX demasiado antigua");
        return { status: "UNAVAILABLE", reason: "STALE_RATE", from, to };
      }
      const [snapshot] = await db
        .insert(fxRateSnapshots)
        .values({
          fromCurrency: from,
          toCurrency: to,
          rate: result.quote.rate,
          provider: provider.name,
          providerReference: result.quote.providerReference,
          rateDate: result.quote.rateDate,
          rateTimestamp,
          fetchedAt: at,
          validUntil,
          isSimulated: provider.isSimulated,
        })
        .returning();
      return { status: "OK", snapshot: snapshot! };
    },
  };
}

export type FxService = ReturnType<typeof createFxService>;
