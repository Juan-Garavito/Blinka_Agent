/**
 * Formato de importes SIN coma flotante: los importes llegan como strings
 * decimales del backend ("1200.0000") y se formatean manipulando texto/BigInt.
 * Convención es-CO: miles con "." y decimales con ",".
 */
export function formatDecimal(value, { minFraction = 2, maxFraction = 4 } = {}) {
  if (value === null || value === undefined || value === "") return "—";
  const str = String(value).trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(str);
  if (!m) return str;
  const [, sign, int, frac = ""] = m;
  let f = frac.replace(/0+$/, "");
  if (f.length < minFraction) f = f.padEnd(minFraction, "0");
  // Nunca se recorta información: si hay más decimales significativos que maxFraction, se muestran.
  if (f.length > maxFraction && /[1-9]/.test(f.slice(maxFraction))) f = frac.replace(/0+$/, "");
  else f = f.slice(0, Math.max(minFraction, Math.min(f.length, maxFraction)));
  const grouped = BigInt(int).toLocaleString("es-CO");
  return `${sign}${grouped}${f ? `,${f}` : ""}`;
}

export function formatMoney(value, currency) {
  if (value === null || value === undefined || value === "") return "—";
  return `${formatDecimal(value)} ${currency ?? ""}`.trim();
}

/** Tasas FX: todos los decimales significativos (12 máx.), sin redondear. */
export function formatRate(value) {
  return formatDecimal(value, { minFraction: 0, maxFraction: 12 });
}

const dateFmt = new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** "2026-10-10" (fecha civil del documento) → no aplicar zona horaria. */
export function formatDate(iso) {
  if (!iso) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split("-").map(Number);
    return dateFmt.format(new Date(Date.UTC(y, m - 1, d, 12)));
  }
  return dateFmt.format(new Date(iso));
}
export function formatDateTime(iso) {
  return iso ? dateTimeFmt.format(new Date(iso)) : "—";
}
export function formatPeriod(period) {
  if (!period) return "—";
  const [y, m] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 15)));
}
export function formatDuration(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
  return `${Math.round(ms / 60000)} min`;
}
export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}
export const shortId = (id) => (id ? id.slice(0, 8).toUpperCase() : "—");

/** Decimal string → BigInt escalado a 4 decimales (sin coma flotante). */
export function toScaled(value, scale = 4) {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const [, sign, int, frac = ""] = m;
  const v = BigInt(int + frac.padEnd(scale, "0").slice(0, scale));
  return sign ? -v : v;
}

/** Proporción a/b en por mil (entero 0–1000), calculada con BigInt. Solo para barras visuales. */
export function ratioPermille(a, b) {
  const x = toScaled(a);
  const y = toScaled(b);
  if (x === null || y === null || y <= 0n) return 0;
  const r = (x * 1000n) / y;
  return Number(r < 0n ? 0n : r > 1000n ? 1000n : r);
}

const rtf = new Intl.RelativeTimeFormat("es-CO", { numeric: "auto" });
/** "hace 5 min" para marcas de tiempo recientes; fecha completa si > 7 días. */
export function formatRelative(iso, now = Date.now()) {
  if (!iso) return "—";
  const s = Math.round((new Date(iso).getTime() - now) / 1000);
  const a = Math.abs(s);
  if (a < 45) return "hace un momento";
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (a < 7 * 86400) return rtf.format(Math.round(s / 86400), "day");
  return formatDateTime(iso);
}

/** "100000.0000" → "100000"; "12.5000" → "12.5"; "100" se conserva (para precargar formularios). */
export const trimZeros = (v) => (v == null ? "" : String(v).includes(".") ? String(v).replace(/0+$/, "").replace(/\.$/, "") : String(v));
