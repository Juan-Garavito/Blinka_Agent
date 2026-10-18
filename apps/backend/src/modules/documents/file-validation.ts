import type { DocumentMimeType } from "./documents.schema.js";

/** Firmas (magic bytes) de los formatos admitidos. XML no se admite en P0. */
const SIGNATURES: Array<{ mime: DocumentMimeType; bytes: number[] }> = [
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
];

const EXTENSIONS: Record<DocumentMimeType, string[]> = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
};

/** Tipo real según los primeros bytes, o undefined si no es un formato admitido. */
export function sniffMimeType(data: Buffer): DocumentMimeType | undefined {
  return SIGNATURES.find((s) => data.length >= s.bytes.length && s.bytes.every((b, i) => data[i] === b))?.mime;
}

/**
 * Nombre seguro para metadatos y Content-Disposition: solo el nombre base,
 * sin controles ni separadores, longitud acotada y extensión coherente con el
 * tipo real. Nunca se usa para construir rutas.
 */
export function sanitizeFileName(raw: string | undefined, mime: DocumentMimeType): string {
  let name = (raw ?? "").normalize("NFC");
  name = name.split(/[/\\]/).pop() ?? "";
  name = name
    .replace(/[\p{C}]/gu, "")
    .replace(/[^\p{L}\p{N} ._()-]/gu, "_")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  const allowed = EXTENSIONS[mime];
  const ext = allowed[0]!;
  const lower = name.toLowerCase();
  if (!allowed.some((e) => lower.endsWith(e))) name = `${name.replace(/\.[^.]*$/, "")}${ext}`;
  if (name === ext || name.length === 0) name = `documento${ext}`;
  if (name.length > 120) name = `${name.slice(0, 120 - ext.length)}${ext}`;
  return name;
}
