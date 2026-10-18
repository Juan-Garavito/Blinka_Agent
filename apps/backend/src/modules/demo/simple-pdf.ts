/**
 * Generador mínimo de PDF VÁLIDO con capa de texto (Helvetica, WinAnsi) para
 * documentos FICTICIOS de pruebas y demo. No pretende maquetar: una línea de
 * texto por renglón, varias páginas si se indican. `comment` se añade como
 * comentario PDF (invisible) — p. ej. el marcador del proveedor FAKE (MOCK).
 */
export function buildTextPdf(pages: string[][], comment?: string): Buffer {
  const esc = (t: string) => t.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const objects: string[] = [];
  const pageIds: number[] = [];
  const fontId = 3;
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  let next = 4;
  for (const lines of pages) {
    const content = ["BT", "/F1 11 Tf", "14 TL", "50 790 Td", ...lines.map((l) => `(${esc(l)}) Tj T*`), "ET"].join("\n");
    const contentId = next++;
    const pageId = next++;
    objects[contentId] = `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    pageIds.push(pageId);
  }
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  if (comment) out += `% ${comment.replace(/[\r\n]/g, " ")}\n`;
  const offsets: number[] = [];
  for (let i = 1; i < next; i++) {
    offsets[i] = Buffer.byteLength(out, "latin1");
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${next}\n0000000000 65535 f \n`;
  for (let i = 1; i < next; i++) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${next} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
