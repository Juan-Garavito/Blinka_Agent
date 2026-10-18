import { createHash } from "node:crypto";
import { extractText, getDocumentProxy } from "unpdf";
import type { DocumentMimeType } from "../documents/documents.schema.js";
import type { TextLayerStatus } from "./evidence.schema.js";

export const TEXT_EXTRACTOR = "unpdf/pdf.js@1.9";

export interface TextLayer {
  status: TextLayerStatus;
  pages: string[];
  detail: string | null;
  textSha256: string | null;
}

const LIMITS = { maxPages: 50, maxChars: 500_000, timeoutMs: 10_000, minMeaningfulChars: 20 };

/**
 * Extrae la capa de texto de un documento de forma DETERMINISTA (sin IA).
 * - PDF con texto digital → TEXT (texto por página).
 * - PDF sin texto (escaneo) o imágenes PNG/JPEG → NO_TEXT: requiere corroboración humana.
 * - PDF corrupto, demasiado grande o lento → UNPARSEABLE (también requiere corroboración).
 * La compilación de pdf.js empaquetada por unpdf no evalúa código (no contiene `new Function`);
 * además se desactivan fuentes del sistema y FontFace.
 */
export async function extractTextLayer(mimeType: DocumentMimeType, data: Buffer): Promise<TextLayer> {
  if (mimeType !== "application/pdf") return { status: "NO_TEXT", pages: [], detail: "imagen sin capa de texto (requiere verificación humana u OCR)", textSha256: null };
  let timer: NodeJS.Timeout | undefined;
  try {
    const work = (async (): Promise<string[] | null> => {
      const doc = await getDocumentProxy(new Uint8Array(data), { disableFontFace: true, useSystemFonts: false, verbosity: 0 });
      if (doc.numPages > LIMITS.maxPages) return null;
      const { text } = await extractText(doc, { mergePages: false });
      return text;
    })();
    const res = await Promise.race([work, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("timeout")), LIMITS.timeoutMs)))]);
    if (res === null) return { status: "UNPARSEABLE", pages: [], detail: `más de ${LIMITS.maxPages} páginas`, textSha256: null };
    const pages = res.map((p) => p.normalize("NFC"));
    const total = pages.reduce((n, p) => n + p.length, 0);
    if (total > LIMITS.maxChars) return { status: "UNPARSEABLE", pages: [], detail: "texto excede el límite", textSha256: null };
    const meaningful = pages.join("").replace(/\s+/g, "").length;
    if (meaningful < LIMITS.minMeaningfulChars) return { status: "NO_TEXT", pages: [], detail: "PDF sin texto digital (posible escaneo)", textSha256: null };
    return { status: "TEXT", pages, detail: null, textSha256: createHash("sha256").update(pages.join("\f")).digest("hex") };
  } catch (err) {
    return { status: "UNPARSEABLE", pages: [], detail: err instanceof Error ? err.message.slice(0, 200) : "error de lectura", textSha256: null };
  } finally {
    clearTimeout(timer);
  }
}
