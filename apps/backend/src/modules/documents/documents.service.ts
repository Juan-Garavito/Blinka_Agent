import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { Database } from "../../shared/db/client.js";
import { AppError, notFound } from "../../shared/errors/app-error.js";
import type { CompanyCtx } from "../../shared/http/context.js";
import type { Logger } from "../../shared/logger.js";
import { recordAudit } from "../audit/audit.service.js";
import { documentTextLayers, documentTextPages } from "../evidence/evidence.schema.js";
import { extractTextLayer, TEXT_EXTRACTOR } from "../evidence/text-layer.js";
import { documents, type DocumentKind } from "./documents.schema.js";
import { sanitizeFileName, sniffMimeType } from "./file-validation.js";
import type { DocumentStorage } from "./storage.js";

export type DocumentRecord = typeof documents.$inferSelect;

export function publicDocument(d: DocumentRecord) {
  return {
    id: d.id,
    kind: d.kind,
    originalName: d.originalName,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    sha256: d.sha256,
    createdAt: d.createdAt.toISOString(),
  };
}

export function createDocumentsService(deps: { db: Database; storage: DocumentStorage; logger: Logger; maxBytes: number }) {
  const { db, storage, logger } = deps;

  async function getScoped(ctx: CompanyCtx, id: string): Promise<DocumentRecord> {
    const [doc] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.companyId, ctx.companyId)))
      .limit(1);
    if (!doc) throw notFound("Documento no encontrado");
    return doc;
  }

  return {
    getScoped,

    /**
     * Valida y guarda un archivo original privado. El tipo real (magic bytes)
     * debe coincidir con el declarado. El contenido NO se interpreta ni ejecuta.
     */
    async upload(ctx: CompanyCtx, input: { kind: DocumentKind; data: Buffer; declaredType: string; fileName?: string }) {
      if (input.data.length === 0) throw new AppError(400, "EMPTY_FILE", "El archivo está vacío");
      if (input.data.length > deps.maxBytes) throw new AppError(413, "PAYLOAD_TOO_LARGE", "El archivo excede el tamaño máximo");
      const sniffed = sniffMimeType(input.data);
      if (!sniffed) throw new AppError(415, "UNSUPPORTED_FILE_TYPE", "Formato no admitido: solo PDF, PNG o JPEG");
      const declared = input.declaredType.split(";")[0]!.trim().toLowerCase();
      if (declared !== sniffed) {
        throw new AppError(415, "FILE_TYPE_MISMATCH", "El tipo declarado no coincide con el contenido del archivo");
      }

      const id = randomUUID();
      const storageKey = `companies/${ctx.companyId}/documents/${id}`;
      const sha256 = createHash("sha256").update(input.data).digest("hex");
      const originalName = sanitizeFileName(input.fileName, sniffed);

      await storage.put(storageKey, input.data, sniffed);
      // Capa de texto determinista para verificar evidencias (sin IA): se guarda una sola vez, inmutable.
      const layer = await extractTextLayer(sniffed, input.data);
      const [duplicate] = await db
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.companyId, ctx.companyId), eq(documents.sha256, sha256)))
        .limit(1);

      const doc = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(documents)
          .values({
            id,
            companyId: ctx.companyId,
            kind: input.kind,
            storageKey,
            originalName,
            mimeType: sniffed,
            sizeBytes: input.data.length,
            sha256,
            uploadedByUserId: ctx.actor.kind === "USER" ? ctx.actor.ref : null,
          })
          .returning();
        await tx.insert(documentTextLayers).values({ companyId: ctx.companyId, documentId: id, status: layer.status, pageCount: layer.pages.length, extractor: TEXT_EXTRACTOR, textSha256: layer.textSha256, detail: layer.detail });
        if (layer.pages.length > 0) {
          await tx.insert(documentTextPages).values(layer.pages.map((text, i) => ({ companyId: ctx.companyId, documentId: id, pageNo: i + 1, text })));
        }
        await recordAudit(tx, {
          companyId: ctx.companyId,
          actor: ctx.actor,
          eventType: "document.uploaded",
          entityType: "document",
          entityRef: id,
          details: { kind: input.kind, mimeType: sniffed, sizeBytes: input.data.length, sameContentAs: duplicate?.id ?? null, textLayer: layer.status },
        });
        return row!;
      });
      logger.info({ documentId: id, kind: input.kind, companyId: ctx.companyId }, "Documento almacenado");
      return { document: doc, sameContentAsDocumentId: duplicate?.id ?? null, textLayer: { status: layer.status, pageCount: layer.pages.length, detail: layer.detail } };
    },

    /** Capa de texto del documento (solo lectura, misma autorización que el contenido). */
    async text(ctx: CompanyCtx, id: string) {
      const doc = await getScoped(ctx, id);
      const [layer] = await db.select().from(documentTextLayers).where(eq(documentTextLayers.documentId, doc.id));
      const pages = layer?.status === "TEXT" ? await db.select({ pageNo: documentTextPages.pageNo, text: documentTextPages.text }).from(documentTextPages).where(eq(documentTextPages.documentId, doc.id)).orderBy(asc(documentTextPages.pageNo)) : [];
      return { documentId: doc.id, mimeType: doc.mimeType, layer: layer ? { status: layer.status, pageCount: layer.pageCount, extractor: layer.extractor, detail: layer.detail } : { status: "MISSING", pageCount: 0, extractor: null, detail: "documento anterior a la verificación" }, pages };
    },

    async content(ctx: CompanyCtx, id: string) {
      const doc = await getScoped(ctx, id);
      return { doc, data: await storage.get(doc.storageKey) };
    },

    /** URL temporal tras autorización: firmada por el proveedor o la ruta autenticada de la API. */
    async access(ctx: CompanyCtx, id: string) {
      const doc = await getScoped(ctx, id);
      const ttl = 60;
      if (storage.createSignedUrl) {
        return { url: await storage.createSignedUrl(doc.storageKey, ttl), expiresInSeconds: ttl, authenticated: false };
      }
      return { url: `/api/documents/${doc.id}/content`, expiresInSeconds: null, authenticated: true };
    },
  };
}

export type DocumentsService = ReturnType<typeof createDocumentsService>;
