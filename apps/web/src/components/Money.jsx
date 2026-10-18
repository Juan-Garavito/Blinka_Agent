import { formatDecimal } from "../lib/format.js";

/** Importe con moneda SIEMPRE explícita; cifras tabulares. El valor llega como string decimal. */
export function Money({ value, currency, strong = false, className = "" }) {
  if (value === null || value === undefined || value === "") return <span className={`num muted ${className}`}>—</span>;
  return (
    <span className={`num ${className}`} style={strong ? { fontWeight: 650 } : undefined}>
      {formatDecimal(value)} <span className="cur">{currency}</span>
    </span>
  );
}
