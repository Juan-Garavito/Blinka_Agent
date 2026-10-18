import { D } from "../../shared/money.js";
import type { TextLayerStatus } from "./evidence.schema.js";

/**
 * Verificación DETERMINISTA de evidencias: coteja cada campo financiero o
 * contractual con la capa de texto del documento ORIGINAL (no con lo que dice
 * el modelo) y devuelve la ubicación real (página, posición, fragmento).
 * Función pura: misma entrada ⇒ mismo resultado.
 */
export type EvidenceKind = "IDENTIFIER" | "AMOUNT" | "TOTAL_AMOUNT" | "QUANTITY" | "CURRENCY" | "DATE";
export type FieldEvidenceStatus = "TEXT_VERIFIED" | "NOT_FOUND" | "UNVERIFIABLE" | "HUMAN_CONFIRMED";

export interface EvidenceField {
  field: string;
  kind: EvidenceKind;
  value: string;
  /** Crítico: número, total, moneda, fecha de emisión y cuenta de destino. */
  critical: boolean;
}

export interface FieldEvidence extends EvidenceField {
  status: FieldEvidenceStatus;
  page: number | null;
  start: number | null;
  end: number | null;
  excerpt: string | null;
}

export interface VerifierLayer {
  status: TextLayerStatus | "MISSING";
  pages: string[];
}

interface Hit {
  page: number;
  start: number;
  end: number;
}

const normId = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");
const stripAccents = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Líneas de una página con su desplazamiento en caracteres. */
function linesOf(text: string): Array<{ text: string; offset: number }> {
  const out: Array<{ text: string; offset: number }> = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    out.push({ text: line, offset });
    offset += line.length + 1;
  }
  return out;
}

// ─────────────── Identificadores (número de factura, referencias, NIT, cuentas) ───────────────

/** Coincidencia por ventanas de palabras CONSECUTIVAS de la misma línea: respeta límites de palabra. */
function findIdentifier(pages: string[], value: string): Hit | null {
  const target = normId(value);
  if (!target) return null;
  for (let p = 0; p < pages.length; p++) {
    for (const line of linesOf(pages[p]!)) {
      const tokens = [...line.text.matchAll(/[^\s:#,;()[\]|]+/g)].map((m) => ({ start: m.index, end: m.index + m[0].length, norms: tokenNorms(m[0]) }));
      for (let i = 0; i < tokens.length; i++) {
        for (const first of tokens[i]!.norms) {
          let acc = first;
          for (let j = i; j < Math.min(tokens.length, i + 8); j++) {
            if (j > i) acc += normId(line.text.slice(tokens[j]!.start, tokens[j]!.end));
            if (acc === target) return { page: p + 1, start: line.offset + tokens[i]!.start, end: line.offset + tokens[j]!.end };
            if (acc.length >= target.length) break;
          }
        }
      }
    }
  }
  return null;
}

/** Normalizaciones de una palabra: completa y sin prefijos tipo "No." / "Nº" / "N°". */
function tokenNorms(token: string): string[] {
  const full = normId(token);
  const m = /^(?:n[oº°r]?|num)\.?\s*(.+)$/i.exec(token);
  const alt = m && /[0-9]/.test(m[1]!) ? normId(m[1]!) : null;
  return alt && alt !== full ? [full, alt] : [full];
}

// ─────────────── Importes y cantidades ───────────────

/**
 * Interpreta un número escrito en el documento sin ambigüedad decimal:
 * - con "." y ",": el último es el separador decimal ("1.200,50" / "1,200.50");
 * - un solo tipo repetido: separador de miles ("1.200.000");
 * - un solo separador con exactamente 3 dígitos detrás: miles ("1,200" = 1200);
 * - en otro caso, separador decimal ("1200,5" / "30.00").
 */
export function parseDocumentNumber(token: string): string | null {
  const t = token.replace(/['\u00A0\u202F\u2009 ]/g, "");
  if (!/^\d[\d.,]*$/.test(t) || /[.,]$/.test(t)) return null;
  const dots = (t.match(/\./g) ?? []).length;
  const commas = (t.match(/,/g) ?? []).length;
  let normalized: string;
  if (dots > 0 && commas > 0) {
    const dec = t.lastIndexOf(".") > t.lastIndexOf(",") ? "." : ",";
    const thou = dec === "." ? "," : ".";
    normalized = t.split(thou).join("").replace(dec, ".");
  } else if (dots + commas === 0) {
    normalized = t;
  } else {
    const sep = dots > 0 ? "." : ",";
    const count = dots + commas;
    const after = t.length - t.lastIndexOf(sep) - 1;
    normalized = count > 1 || after === 3 ? t.split(sep).join("") : t.replace(sep, ".");
    if (count > 1 && !t.split(sep).slice(1).every((g) => g.length === 3)) return null;
  }
  return /^\d+(\.\d+)?$/.test(normalized) ? normalized : null;
}

/** Números aislados: los dígitos pegados a letras, "/" o "-" (fechas, NIT, códigos) no son importes. */
const NUMBER_TOKEN = /(?<![A-Za-z0-9/-])\d[\d.,'\u00A0\u202F]*(?![A-Za-z0-9/-])/g;
/** Palabras que identifican el importe TOTAL; "SUBTOTAL" queda excluido por el límite de palabra. */
const TOTAL_CONTEXT = /(?:^|[^A-Z])(TOTAL|A PAGAR|AMOUNT DUE|BALANCE DUE|IMPORTE TOTAL|VALOR TOTAL)/;

function findAmount(pages: string[], value: string, totalContext: boolean): Hit | null {
  const target = new D(value);
  for (let p = 0; p < pages.length; p++) {
    const lines = linesOf(pages[p]!);
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]!;
      if (totalContext) {
        const ctx = stripAccents(`${lines[li - 1]?.text ?? ""}\n${line.text}`).toUpperCase();
        if (!TOTAL_CONTEXT.test(ctx)) continue;
      }
      for (const m of line.text.matchAll(NUMBER_TOKEN)) {
        const raw = m[0].replace(/[.,'\u00A0\u202F]+$/, "");
        const parsed = parseDocumentNumber(raw);
        if (parsed !== null && new D(parsed).eq(target)) return { page: p + 1, start: line.offset + m.index, end: line.offset + m.index + raw.length };
      }
    }
  }
  return null;
}

// ─────────────── Moneda ───────────────

const SYMBOLS: Array<[RegExp, string]> = [
  [/€/, "EUR"],
  [/£/, "GBP"],
  [/US\$/, "USD"],
  [/R\$/, "BRL"],
  [/(?:COL|COP)\$/, "COP"],
  [/MX\$/, "MXN"],
  [/(?:CA|C)\$/, "CAD"],
];

/** ISO 4217 como palabra o símbolo inequívoco. "$" solo es ambiguo (USD/COP/MXN…) y no cuenta. */
function findCurrency(pages: string[], code: string): Hit | null {
  for (let p = 0; p < pages.length; p++) {
    const text = pages[p]!;
    const iso = new RegExp(`(?<![A-Za-z])${code}(?![A-Za-z])`).exec(text);
    if (iso) return { page: p + 1, start: iso.index, end: iso.index + code.length };
    for (const [re, c] of SYMBOLS) {
      if (c !== code) continue;
      const m = re.exec(text);
      if (m) return { page: p + 1, start: m.index, end: m.index + m[0].length };
    }
  }
  return null;
}

// ─────────────── Fechas ───────────────

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12, ene: 1, abr: 4, ago: 8, dic: 12,
};

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Fechas reconocidas: ISO, dd/mm/aaaa (convención latinoamericana/europea) y con nombre de mes (es/en). */
function findDate(pages: string[], value: string): Hit | null {
  const patterns: Array<[RegExp, (m: RegExpExecArray) => string | null]> = [
    [/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g, (m) => iso(+m[1]!, +m[2]!, +m[3]!)],
    [/(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?!\d)/g, (m) => iso(+m[3]!, +m[2]!, +m[1]!)],
    [/(?<!\d)(\d{1,2})\s+(?:de\s+)?([a-záéíóú]+)\.?,?\s+(?:de\s+|del\s+)?(\d{4})(?!\d)/gi, (m) => (MONTHS[stripAccents(m[2]!).toLowerCase()] ? iso(+m[3]!, MONTHS[stripAccents(m[2]!).toLowerCase()]!, +m[1]!) : null)],
    [/(?<![a-z])([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})(?!\d)/gi, (m) => (MONTHS[m[1]!.toLowerCase()] ? iso(+m[3]!, MONTHS[m[1]!.toLowerCase()]!, +m[2]!) : null)],
  ];
  for (let p = 0; p < pages.length; p++) {
    for (const [re, toIso] of patterns) {
      for (const m of pages[p]!.matchAll(re)) {
        if (toIso(m) === value) return { page: p + 1, start: m.index, end: m.index + m[0].length };
      }
    }
  }
  return null;
}

function excerptOf(pages: string[], hit: Hit): string {
  const text = pages[hit.page - 1]!;
  const lineStart = text.lastIndexOf("\n", hit.start - 1) + 1;
  const lineEndIdx = text.indexOf("\n", hit.end);
  const line = text.slice(lineStart, lineEndIdx === -1 ? undefined : lineEndIdx).trim();
  return line.length > 200 ? line.slice(Math.max(0, hit.start - lineStart - 80), hit.end - lineStart + 80) : line;
}

/**
 * Verifica cada campo contra la capa de texto. Sin capa de texto, solo una
 * confirmación humana del MISMO valor convierte UNVERIFIABLE en HUMAN_CONFIRMED;
 * con capa de texto, un valor ausente es NOT_FOUND y ninguna confirmación lo cambia.
 */
export function verifyFields(layer: VerifierLayer, fields: EvidenceField[], confirmations: ReadonlyMap<string, string> = new Map()): FieldEvidence[] {
  return fields.map((f) => {
    const none = { page: null, start: null, end: null, excerpt: null };
    if (layer.status !== "TEXT") {
      return confirmations.get(f.field) === f.value ? { ...f, ...none, status: "HUMAN_CONFIRMED" } : { ...f, ...none, status: "UNVERIFIABLE" };
    }
    const hit =
      f.kind === "IDENTIFIER"
        ? findIdentifier(layer.pages, f.value)
        : f.kind === "CURRENCY"
          ? findCurrency(layer.pages, f.value)
          : f.kind === "DATE"
            ? findDate(layer.pages, f.value)
            : findAmount(layer.pages, f.value, f.kind === "TOTAL_AMOUNT");
    return hit ? { ...f, status: "TEXT_VERIFIED", page: hit.page, start: hit.start, end: hit.end, excerpt: excerptOf(layer.pages, hit) } : { ...f, ...none, status: "NOT_FOUND" };
  });
}

export interface VersionForEvidence {
  supplierInvoiceNumber: string | null;
  issuerTaxReference: string | null;
  issueDate: string | null;
  servicePeriodStart: string | null;
  servicePeriodEnd: string | null;
  currency: string | null;
  subtotal: string | null;
  taxes: string | null;
  discounts: string | null;
  totalAmount: string | null;
  contractRefCited: string | null;
  lines: Array<{ lineNo: number; itemRef: string | null; quantity: string | null; unitPrice: string | null; subtotal: string }>;
}

/**
 * Campos que DEBEN tener respaldo documental: todo valor presente que el motor
 * usa para decidir. `matchedAccount` es el número normalizado cuya huella
 * coincidió con la cuenta del proveedor (no el texto libre del modelo).
 */
export function evidenceFieldsFor(v: VersionForEvidence, matchedAccount: string | null): EvidenceField[] {
  const out: EvidenceField[] = [];
  const add = (field: string, kind: EvidenceKind, value: string | null, critical = false) => {
    if (value !== null && value !== "") out.push({ field, kind, value, critical });
  };
  const nonZero = (x: string | null) => (x !== null && !new D(x).isZero() ? x : null);
  add("supplierInvoiceNumber", "IDENTIFIER", v.supplierInvoiceNumber, true);
  add("totalAmount", "TOTAL_AMOUNT", v.totalAmount, true);
  add("currency", "CURRENCY", v.currency, true);
  add("issueDate", "DATE", v.issueDate, true);
  add("paymentAccount", "IDENTIFIER", matchedAccount, true);
  add("contractRefCited", "IDENTIFIER", v.contractRefCited);
  add("issuerTaxReference", "IDENTIFIER", v.issuerTaxReference);
  add("servicePeriodStart", "DATE", v.servicePeriodStart);
  add("servicePeriodEnd", "DATE", v.servicePeriodEnd);
  add("subtotal", "AMOUNT", v.subtotal);
  add("taxes", "AMOUNT", nonZero(v.taxes));
  add("discounts", "AMOUNT", nonZero(v.discounts));
  for (const l of v.lines) {
    add(`lines[${l.lineNo}].subtotal`, "AMOUNT", l.subtotal);
    add(`lines[${l.lineNo}].unitPrice`, "AMOUNT", l.unitPrice);
    add(`lines[${l.lineNo}].quantity`, "QUANTITY", l.quantity);
    add(`lines[${l.lineNo}].itemRef`, "IDENTIFIER", l.itemRef);
  }
  return out;
}

/** Código de regla para un campo: totalAmount → EVIDENCE_TOTAL_AMOUNT; lines[2].unitPrice → EVIDENCE_LINE_2_UNIT_PRICE. */
export const evidenceRuleCode = (field: string) =>
  `EVIDENCE_${field
    .replace(/^lines\[(\d+)\]\./, "LINE_$1_")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toUpperCase()}`;
