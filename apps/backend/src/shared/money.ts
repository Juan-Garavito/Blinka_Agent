import { Decimal } from "decimal.js";
import { z } from "zod";

/**
 * Aritmética monetaria exacta. Nunca se usa `number` de JavaScript para
 * importes, tasas, límites ni acumulados.
 */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
export type Dec = InstanceType<typeof D>;

/** Importe no negativo como string decimal (hasta 16 enteros y 4 decimales). */
export const moneyString = z.string().regex(/^\d{1,16}(\.\d{1,4})?$/, "importe decimal no negativo como string, p. ej. \"1250.00\"");
export const positiveMoneyString = moneyString.refine((v) => new D(v).gt(0), { error: "debe ser mayor que 0" });
export const quantityString = z
  .string()
  .regex(/^\d{1,16}(\.\d{1,4})?$/, "cantidad decimal como string")
  .refine((v) => new D(v).gt(0), { error: "debe ser mayor que 0" });
export const unitPriceString = z.string().regex(/^\d{1,14}(\.\d{1,6})?$/, "precio unitario decimal como string");
export const currencyString = z.string().regex(/^[A-Z]{3}$/, "código ISO 4217 en mayúsculas");
export const isoDate = z.iso.date();

export const dec = (v: string | Dec) => new D(v);

/** Representación canónica con 4 decimales (escala de las columnas money). */
export const toMoney4 = (v: Dec) => v.toDecimalPlaces(4, Decimal.ROUND_HALF_EVEN).toFixed(4);

/**
 * Redondeo conservador para importes a reservar en moneda base: hacia arriba,
 * de modo que una conversión nunca reserve menos de lo debido.
 */
export const toReserveAmount = (v: Dec) => v.toDecimalPlaces(4, Decimal.ROUND_UP).toFixed(4);
