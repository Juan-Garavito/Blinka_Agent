import { createHmac } from "node:crypto";
import { AppError } from "../../shared/errors/app-error.js";

/** Normaliza un identificador de cuenta/IBAN: mayúsculas y solo alfanuméricos. */
export const normalizeAccountNumber = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Huella HMAC-SHA256 del número normalizado. Con una clave de servidor, una
 * filtración de la tabla no permite recuperar números por fuerza bruta.
 */
export function accountFingerprint(secret: string | undefined, normalized: string): string {
  if (!secret) throw new AppError(500, "CONFIG_MISSING", "ACCOUNT_FINGERPRINT_SECRET no configurada", { expose: false });
  return createHmac("sha256", secret).update(`acct:v1:${normalized}`).digest("hex");
}

export const accountMask = (normalized: string) => `****${normalized.slice(-4)}`;

/**
 * Candidatos de cuenta dentro de un texto libre de factura (destino de pago).
 * Las cuentas suelen escribirse en grupos ("CO98 7654 3210 1122"), por eso se
 * prueban ventanas de hasta 8 palabras consecutivas; cada candidato normalizado
 * debe tener 6–34 caracteres y al menos 4 dígitos seguidos.
 */
export function accountCandidatesFromText(raw: string): string[] {
  const words = raw
    .toUpperCase()
    .split(/[\s,;:/|()]+/)
    .map((w) => w.replace(/[^A-Z0-9.-]/g, ""))
    .filter(Boolean)
    .slice(0, 80);
  const out = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    let acc = "";
    for (let j = i; j < Math.min(words.length, i + 8); j++) {
      acc += normalizeAccountNumber(words[j]!);
      if (acc.length > 34) break;
      if (acc.length >= 6 && /\d{4}/.test(acc)) out.add(acc);
    }
  }
  return [...out];
}

/**
 * Empareja el destino de pago (texto libre) con las cuentas registradas por huella.
 * Devuelve el resultado y el número normalizado CONCRETO que coincidió con una
 * cuenta del proveedor (es el que debe constar en el documento).
 */
export function matchAccount(
  raw: string | null,
  secret: string | undefined,
  accounts: Array<{ id: string; vendorId: string; status: "PENDING" | "AUTHORIZED" | "BLOCKED"; fingerprint: string }>,
  vendorId: string,
):
  | { kind: "NOT_DECLARED"; number: null }
  | { kind: "UNREGISTERED"; number: null }
  | { kind: "OTHER_VENDOR"; number: null }
  | { kind: "MATCHED"; accountId: string; status: "PENDING" | "AUTHORIZED" | "BLOCKED"; number: string } {
  if (!raw) return { kind: "NOT_DECLARED", number: null };
  const candidates = accountCandidatesFromText(raw).map((n) => ({ n, fp: accountFingerprint(secret, n) }));
  for (const c of candidates) {
    const own = accounts.find((a) => a.vendorId === vendorId && a.fingerprint === c.fp);
    if (own) return { kind: "MATCHED", accountId: own.id, status: own.status, number: c.n };
  }
  return candidates.some((c) => accounts.some((a) => a.fingerprint === c.fp)) ? { kind: "OTHER_VENDOR", number: null } : { kind: "UNREGISTERED", number: null };
}
