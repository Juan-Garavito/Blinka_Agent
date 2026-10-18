import express, { Router } from "express";
import { z } from "zod";
import { ctxOf, idParam } from "../../shared/http/context.js";
import { DOCUMENT_KINDS, DOCUMENT_MIME_TYPES } from "./documents.schema.js";
import { publicDocument, type DocumentsService } from "./documents.service.js";

const uploadQuery = z.object({ kind: z.enum(DOCUMENT_KINDS) });

/** Codifica el nombre para Content-Disposition (RFC 6266 / 5987). */
const contentDisposition = (type: "attachment" | "inline", name: string) =>
  `${type}; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

export function documentsRouter(service: DocumentsService, maxBytes: number): Router {
  const router = Router();

  /**
   * Subida binaria: el cuerpo es el archivo (Content-Type application/pdf,
   * image/png o image/jpeg) y el nombre va en X-File-Name (URI-encoded).
   * Esos tipos no son "simples" para CORS, así que un sitio ajeno no puede
   * enviarlos sin preflight (protección CSRF adicional al token).
   */
  router.post("/documents", express.raw({ type: [...DOCUMENT_MIME_TYPES], limit: maxBytes }), async (req, res) => {
    const { kind } = uploadQuery.parse(req.query);
    const rawName = req.get("x-file-name");
    let fileName: string | undefined;
    try {
      fileName = rawName ? decodeURIComponent(rawName) : undefined;
    } catch {
      fileName = undefined;
    }
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const result = await service.upload(ctxOf(req), { kind, data, declaredType: req.get("content-type") ?? "", fileName });
    res.status(201).json({ document: publicDocument(result.document), sameContentAsDocumentId: result.sameContentAsDocumentId, textLayer: result.textLayer });
  });

  router.get("/documents/:id", async (req, res) => {
    res.json({ document: publicDocument(await service.getScoped(ctxOf(req), idParam(req, "id"))) });
  });

  router.get("/documents/:id/text", async (req, res) => {
    res.set("Cache-Control", "private, no-store").json(await service.text(ctxOf(req), idParam(req, "id")));
  });

  router.get("/documents/:id/access", async (req, res) => {
    res.set("Cache-Control", "no-store").json(await service.access(ctxOf(req), idParam(req, "id")));
  });

  router.get("/documents/:id/content", async (req, res) => {
    const { doc, data } = await service.content(ctxOf(req), idParam(req, "id"));
    const inline = req.query.disposition === "inline";
    res
      .status(200)
      .set({
        "Content-Type": doc.mimeType,
        "Content-Length": String(data.length),
        "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", doc.originalName),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
      })
      .end(data);
  });

  return router;
}
