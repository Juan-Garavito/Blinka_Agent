import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../shared/db/client.js";
import { AppError, notFound } from "../../shared/errors/app-error.js";
import { pgErrorOf } from "../../shared/errors/pg-error.js";
import type { CompanyCtx } from "../../shared/http/context.js";
import { currencyString, isoDate, moneyString, quantityString, unitPriceString } from "../../shared/money.js";
import { recordAudit, type Executor } from "../audit/audit.service.js";
import { expenseCategories } from "../company-config/company-config.schema.js";
import { documents } from "../documents/documents.schema.js";
import { documentTextLayers, invoiceFieldConfirmations } from "../evidence/evidence.schema.js";
import { evidenceFieldsFor } from "../evidence/verifier.js";
import { matchAccount } from "../vendors/account-fingerprint.js";
import { vendorBankAccounts, vendors } from "../vendors/vendors.schema.js";
import { ATTACHMENT_PURPOSES, invoiceAttachments, invoiceLines, invoices, invoiceVersions, type InvoiceVersionOrigin } from "./invoices.schema.js";

export const INVOICE_LIST_STATUSES = ["AUTORIZADA", "EN_APROBACION", "EN_CORRECCION", "BLOQUEADA", "RECHAZADA", "ERROR", "NOT_EVALUATED", "PROCESSING"] as const;

export const invoiceListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  status: z.enum(INVOICE_LIST_STATUSES).optional(),
  vendorId: z.uuid().optional(),
  currency: currencyString.optional(),
  q: z.string().trim().min(1).max(80).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  sort: z.enum(["created_desc", "created_asc", "amount_desc", "amount_asc"]).default("created_desc"),
});

export const confirmationBody = z.object({ fields: z.array(z.string().min(2).max(60)).min(1).max(40), reason: z.string().trim().min(10).max(500) }).strict();

export const attachmentBody = z
  .object({ documentId: z.uuid(), purpose: z.enum(ATTACHMENT_PURPOSES), milestoneRef: z.string().trim().min(1).max(80).optional() })
  .strict();

/**
 * Número fiscal normalizado para la identidad (empresa, proveedor, número):
 * mayúsculas y solo alfanuméricos ("FAC-000123" → "FAC000123"). No se quitan
 * ceros a la izquierda: dos números distintos nunca deben colapsar en uno.
 */
export const normalizeInvoiceNumber = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, "");

const lineInput = z
  .object({
    concept: z.string().trim().min(1).max(300),
    itemRef: z.string().trim().min(1).max(80).optional(),
    quantity: quantityString.optional(),
    unit: z.string().trim().min(1).max(20).optional(),
    unitPrice: unitPriceString.optional(),
    subtotal: moneyString,
    taxAmount: moneyString.optional(),
  })
  .strict();

/** Datos de una versión. Todo es opcional: lo que falte se resuelve como corrección, nunca se supone. */
export const invoiceDataInput = z
  .object({
    supplierInvoiceNumber: z.string().trim().min(1).max(60).optional(),
    issuerTaxReference: z.string().trim().min(1).max(60).optional(),
    issueDate: isoDate.optional(),
    dueDate: isoDate.optional(),
    servicePeriodStart: isoDate.optional(),
    servicePeriodEnd: isoDate.optional(),
    currency: currencyString.optional(),
    subtotal: moneyString.optional(),
    taxes: moneyString.optional(),
    discounts: moneyString.optional(),
    totalAmount: moneyString.optional(),
    contractRefCited: z.string().trim().min(1).max(80).optional(),
    paymentDestinationRaw: z.string().trim().min(1).max(300).optional(),
    lines: z.array(lineInput).max(200).default([]),
  })
  .strict()
  .refine((d) => !d.servicePeriodStart || !d.servicePeriodEnd || d.servicePeriodEnd >= d.servicePeriodStart, {
    error: "servicePeriodEnd no puede ser anterior a servicePeriodStart",
    path: ["servicePeriodEnd"],
  })
  .refine((d) => !d.supplierInvoiceNumber || normalizeInvoiceNumber(d.supplierInvoiceNumber).length > 0, {
    error: "el número de factura debe contener caracteres alfanuméricos",
    path: ["supplierInvoiceNumber"],
  });

export type InvoiceData = z.infer<typeof invoiceDataInput>;

export const invoiceCreateBody = z
  .object({
    /** Proveedor OBLIGATORIO al cargar la factura. */
    vendorId: z.uuid(),
    documentId: z.uuid(),
    categoryId: z.uuid().optional(),
    /** Emisión legal nueva (otro número) que sustituye a una factura previa. */
    replacesInvoiceId: z.uuid().optional(),
    data: invoiceDataInput.optional(),
  })
  .strict();

export const invoiceVersionBody = z
  .object({ data: invoiceDataInput, documentId: z.uuid().optional(), reason: z.string().trim().min(3).max(500) })
  .strict();

export function createInvoicesService(db: Database, opts: { fingerprintSecret?: string | undefined } = {}) {
  async function getInvoice(exec: Executor, ctx: CompanyCtx, id: string) {
    const [inv] = await exec.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.companyId, ctx.companyId))).limit(1);
    if (!inv) throw notFound("Factura no encontrada");
    return inv;
  }

  async function assertInvoiceDocument(exec: Executor, ctx: CompanyCtx, documentId: string, invoiceId?: string) {
    const [doc] = await exec
      .select({ kind: documents.kind })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.companyId, ctx.companyId)));
    if (!doc) throw notFound("Documento no encontrado");
    if (doc.kind !== "INVOICE") throw new AppError(400, "INVALID_DOCUMENT_KIND", "El documento debe ser de tipo INVOICE");
    const [usedBy] = await exec
      .select({ invoiceId: invoiceVersions.invoiceId })
      .from(invoiceVersions)
      .where(
        and(
          eq(invoiceVersions.companyId, ctx.companyId),
          eq(invoiceVersions.sourceDocumentId, documentId),
          invoiceId ? ne(invoiceVersions.invoiceId, invoiceId) : undefined,
        ),
      )
      .limit(1);
    if (usedBy) throw new AppError(409, "DOCUMENT_ALREADY_LINKED", "El documento ya pertenece a otra factura", { details: { invoiceId: usedBy.invoiceId } });
  }

  /**
   * Reclama la identidad (empresa, proveedor, número). Si otra factura ya la
   * tiene, esta queda enlazada como duplicada (duplicate_of_invoice_id) y SIN
   * identidad: el motor la BLOQUEARÁ (FIN-02). El UNIQUE parcial resuelve las carreras.
   */
  async function applyIdentity(tx: Executor & Pick<Database, "transaction">, ctx: CompanyCtx, invoiceId: string, vendorId: string, rawNumber: string | undefined) {
    if (!rawNumber) return { duplicateOf: null as string | null };
    const normalized = normalizeInvoiceNumber(rawNumber);
    try {
      await tx.transaction(async (sp) => {
        await sp.update(invoices).set({ invoiceNumberNormalized: normalized, duplicateOfInvoiceId: null }).where(eq(invoices.id, invoiceId));
      });
      return { duplicateOf: null };
    } catch (err) {
      if (pgErrorOf(err)?.constraint !== "invoices_identity_key") throw err;
    }
    const [canonical] = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.companyId, ctx.companyId), eq(invoices.vendorId, vendorId), eq(invoices.invoiceNumberNormalized, normalized)));
    await tx.update(invoices).set({ invoiceNumberNormalized: null, duplicateOfInvoiceId: canonical!.id }).where(eq(invoices.id, invoiceId));
    await recordAudit(tx, {
      companyId: ctx.companyId,
      actor: ctx.actor,
      eventType: "invoice.duplicate_detected",
      entityType: "invoice",
      entityRef: invoiceId,
      details: { duplicateOf: canonical!.id, invoiceNumberNormalized: normalized },
    });
    return { duplicateOf: canonical!.id };
  }

  async function insertVersion(
    tx: Executor,
    ctx: CompanyCtx,
    invoiceId: string,
    documentId: string,
    data: InvoiceData | undefined,
    origin: InvoiceVersionOrigin,
  ) {
    const [{ next }] = (await tx
      .select({ next: sql<number>`coalesce(max(${invoiceVersions.versionNo}), 0) + 1` })
      .from(invoiceVersions)
      .where(eq(invoiceVersions.invoiceId, invoiceId))) as [{ next: number }];
    const d = data ?? { lines: [] };
    const [version] = await tx
      .insert(invoiceVersions)
      .values({
        companyId: ctx.companyId,
        invoiceId,
        versionNo: Number(next),
        origin,
        sourceDocumentId: documentId,
        supplierInvoiceNumber: d.supplierInvoiceNumber ?? null,
        issuerTaxReference: d.issuerTaxReference ?? null,
        issueDate: d.issueDate ?? null,
        dueDate: d.dueDate ?? null,
        servicePeriodStart: d.servicePeriodStart ?? null,
        servicePeriodEnd: d.servicePeriodEnd ?? null,
        originalCurrency: d.currency ?? null,
        subtotal: d.subtotal ?? null,
        taxes: d.taxes ?? null,
        discounts: d.discounts ?? null,
        totalAmount: d.totalAmount ?? null,
        contractRefCited: d.contractRefCited ?? null,
        paymentDestinationRaw: d.paymentDestinationRaw ?? null,
        createdByUserId: ctx.actor.kind === "USER" ? ctx.actor.ref : null,
      })
      .returning();
    if (d.lines.length > 0) {
      await tx.insert(invoiceLines).values(
        d.lines.map((l, i) => ({
          invoiceVersionId: version!.id,
          lineNo: i + 1,
          concept: l.concept,
          itemRef: l.itemRef ?? null,
          quantity: l.quantity ?? null,
          unit: l.unit ?? null,
          unitPrice: l.unitPrice ?? null,
          subtotal: l.subtotal,
          taxAmount: l.taxAmount ?? null,
        })),
      );
    }
    await tx.update(invoices).set({ currentVersionId: version!.id }).where(eq(invoices.id, invoiceId));
    return version!;
  }

  async function detail(ctx: CompanyCtx, id: string) {
    const invoice = await getInvoice(db, ctx, id);
    const versions = await db
      .select()
      .from(invoiceVersions)
      .where(and(eq(invoiceVersions.invoiceId, id), eq(invoiceVersions.companyId, ctx.companyId)))
      .orderBy(desc(invoiceVersions.versionNo));
    const lines = versions.length
      ? await db
          .select()
          .from(invoiceLines)
          .where(inArray(invoiceLines.invoiceVersionId, versions.map((v) => v.id)))
          .orderBy(asc(invoiceLines.lineNo))
      : [];
    return { invoice, versions: versions.map((v) => ({ ...v, lines: lines.filter((l) => l.invoiceVersionId === v.id) })) };
  }

  return {
    detail,
    getInvoice: (ctx: CompanyCtx, id: string) => getInvoice(db, ctx, id),

    /**
     * Listado con filtros en servidor (solo lectura). `status` admite los seis
     * estados comerciales, NOT_EVALUATED (sin decisión) y PROCESSING (análisis en
     * curso, estado técnico). Devuelve también el total para paginar.
     */
    async list(ctx: CompanyCtx, q: z.infer<typeof invoiceListQuery>) {
      const statusExpr = sql<string | null>`(select r.visible_outcome from evaluation_runs r join evaluation_flows f on f.id = r.flow_id
            where f.invoice_id = ${invoices.id} and r.status = 'COMPLETED' order by r.evaluated_at desc limit 1)`;
      const processingExpr = sql<boolean>`exists(select 1 from evaluation_runs r join evaluation_flows f on f.id = r.flow_id
            where f.invoice_id = ${invoices.id} and r.status = 'RUNNING')`;
      const conditions = [eq(invoices.companyId, ctx.companyId)];
      if (q.vendorId) conditions.push(eq(invoices.vendorId, q.vendorId));
      if (q.currency) conditions.push(eq(invoiceVersions.originalCurrency, q.currency));
      if (q.from) conditions.push(sql`${invoices.createdAt} >= ${q.from}::date`);
      if (q.to) conditions.push(sql`${invoices.createdAt} < (${q.to}::date + 1)`);
      if (q.q) {
        const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        conditions.push(sql`(${invoiceVersions.supplierInvoiceNumber} ilike ${like} or ${vendors.legalName} ilike ${like} or ${invoices.invoiceNumberNormalized} ilike ${like})`);
      }
      if (q.status === "PROCESSING") conditions.push(sql`${processingExpr}`);
      else if (q.status === "NOT_EVALUATED") conditions.push(sql`${statusExpr} is null and not ${processingExpr}`);
      else if (q.status) conditions.push(sql`${statusExpr} = ${q.status}`);
      const where = and(...conditions);
      const order = { created_desc: desc(invoices.createdAt), created_asc: asc(invoices.createdAt), amount_desc: sql`${invoiceVersions.totalAmount} desc nulls last`, amount_asc: sql`${invoiceVersions.totalAmount} asc nulls last` }[q.sort];

      const base = () =>
        db
          .select({
            id: invoices.id,
            vendorId: invoices.vendorId,
            vendorName: vendors.legalName,
            vendorStatus: vendors.status,
            categoryId: invoices.categoryId,
            invoiceNumberNormalized: invoices.invoiceNumberNormalized,
            duplicateOfInvoiceId: invoices.duplicateOfInvoiceId,
            replacesInvoiceId: invoices.replacesInvoiceId,
            currentVersionId: invoices.currentVersionId,
            supplierInvoiceNumber: invoiceVersions.supplierInvoiceNumber,
            currency: invoiceVersions.originalCurrency,
            totalAmount: invoiceVersions.totalAmount,
            issueDate: invoiceVersions.issueDate,
            createdAt: invoices.createdAt,
            /** Estado comercial: último resultado completado (null = sin evaluar). */
            status: statusExpr,
            /** Hay un análisis en curso (estado técnico, no comercial). */
            processing: processingExpr,
          })
          .from(invoices)
          .innerJoin(vendors, and(eq(vendors.id, invoices.vendorId), eq(vendors.companyId, invoices.companyId)))
          .leftJoin(invoiceVersions, eq(invoiceVersions.id, invoices.currentVersionId));
      const rows = await base().where(where).orderBy(order, desc(invoices.id)).limit(q.limit).offset(q.offset);
      const [{ total }] = (await db
        .select({ total: sql<number>`count(*)::int` })
        .from(invoices)
        .innerJoin(vendors, and(eq(vendors.id, invoices.vendorId), eq(vendors.companyId, invoices.companyId)))
        .leftJoin(invoiceVersions, eq(invoiceVersions.id, invoices.currentVersionId))
        .where(where)) as [{ total: number }];
      return { invoices: rows, total, limit: q.limit, offset: q.offset };
    },

    async create(ctx: CompanyCtx, body: z.infer<typeof invoiceCreateBody>) {
      const id = await db.transaction(async (tx) => {
        const [vendor] = await tx.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.id, body.vendorId), eq(vendors.companyId, ctx.companyId)));
        if (!vendor) throw notFound("Proveedor no encontrado");
        if (body.categoryId) {
          const [cat] = await tx
            .select({ id: expenseCategories.id })
            .from(expenseCategories)
            .where(and(eq(expenseCategories.id, body.categoryId), eq(expenseCategories.companyId, ctx.companyId)));
          if (!cat) throw notFound("Categoría no encontrada");
        }
        if (body.replacesInvoiceId) await getInvoice(tx, ctx, body.replacesInvoiceId);
        await assertInvoiceDocument(tx, ctx, body.documentId);

        const [inv] = await tx
          .insert(invoices)
          .values({
            companyId: ctx.companyId,
            vendorId: body.vendorId,
            categoryId: body.categoryId ?? null,
            replacesInvoiceId: body.replacesInvoiceId ?? null,
            createdByUserId: ctx.actor.kind === "USER" ? ctx.actor.ref : null,
          })
          .returning({ id: invoices.id });
        const version = await insertVersion(tx, ctx, inv!.id, body.documentId, body.data, "UPLOAD");
        await recordAudit(tx, {
          companyId: ctx.companyId,
          actor: ctx.actor,
          eventType: "invoice.created",
          entityType: "invoice",
          entityRef: inv!.id,
          details: { vendorId: body.vendorId, documentId: body.documentId, versionId: version.id, replacesInvoiceId: body.replacesInvoiceId ?? null },
        });
        await applyIdentity(tx, ctx, inv!.id, body.vendorId, body.data?.supplierInvoiceNumber);
        return inv!.id;
      });
      return detail(ctx, id);
    },

    /** Adjunta evidencia (EVIDENCE) a la factura: hoja de horas, aceptación de hito, remisión. */
    async addAttachment(ctx: CompanyCtx, invoiceId: string, body: z.infer<typeof attachmentBody>) {
      return db.transaction(async (tx) => {
        await getInvoice(tx, ctx, invoiceId);
        const [doc] = await tx.select({ kind: documents.kind }).from(documents).where(and(eq(documents.id, body.documentId), eq(documents.companyId, ctx.companyId)));
        if (!doc) throw notFound("Documento no encontrado");
        if (doc.kind !== "EVIDENCE") throw new AppError(400, "INVALID_DOCUMENT_KIND", "La evidencia debe ser un documento de tipo EVIDENCE");
        const [row] = await tx
          .insert(invoiceAttachments)
          .values({ companyId: ctx.companyId, invoiceId, documentId: body.documentId, purpose: body.purpose, milestoneRef: body.milestoneRef ?? null, createdByUserId: ctx.actor.kind === "USER" ? ctx.actor.ref : null })
          .returning();
        await recordAudit(tx, { companyId: ctx.companyId, actor: ctx.actor, eventType: "invoice.attachment_added", entityType: "invoice", entityRef: invoiceId, details: { documentId: body.documentId, purpose: body.purpose } });
        return row!;
      });
    },

    /**
     * Corroboración HUMANA de campos que no se pueden verificar por texto (imagen o
     * PDF escaneado/ilegible). Solo para la versión ACTUAL y solo si el documento
     * no tiene capa de texto: una discrepancia en un documento con texto exige
     * corrección (nueva versión o documento), nunca una confirmación.
     */
    async confirmFields(ctx: CompanyCtx, invoiceId: string, versionId: string, body: z.infer<typeof confirmationBody>) {
      if (ctx.actor.kind !== "USER") throw new AppError(403, "HUMAN_REQUIRED", "Solo una persona autenticada confirma evidencias");
      return db.transaction(async (tx) => {
        const inv = await getInvoice(tx, ctx, invoiceId);
        if (inv.currentVersionId !== versionId) throw new AppError(409, "VERSION_NOT_CURRENT", "Solo se confirma la versión actual de la factura");
        const [version] = await tx.select().from(invoiceVersions).where(and(eq(invoiceVersions.id, versionId), eq(invoiceVersions.companyId, ctx.companyId)));
        const [layer] = await tx.select({ status: documentTextLayers.status }).from(documentTextLayers).where(eq(documentTextLayers.documentId, version!.sourceDocumentId));
        if (layer?.status === "TEXT") {
          throw new AppError(409, "EVIDENCE_TEXT_AVAILABLE", "El documento tiene texto verificable: corrige la versión o aporta otro documento; no se admite confirmación manual");
        }
        const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceVersionId, versionId)).orderBy(asc(invoiceLines.lineNo));
        // La cuenta se confirma por el MISMO número que verifica el motor: el que coincide por huella con la cuenta del proveedor.
        const accounts = await tx
          .select({ id: vendorBankAccounts.id, vendorId: vendorBankAccounts.vendorId, status: vendorBankAccounts.status, fingerprint: vendorBankAccounts.accountFingerprint })
          .from(vendorBankAccounts)
          .where(eq(vendorBankAccounts.companyId, ctx.companyId));
        const account = matchAccount(version!.paymentDestinationRaw, opts.fingerprintSecret, accounts, inv.vendorId).number;
        const allowed = new Map(
          evidenceFieldsFor({ ...version!, currency: version!.originalCurrency, lines: lines.map((l) => ({ lineNo: l.lineNo, itemRef: l.itemRef, quantity: l.quantity, unitPrice: l.unitPrice, subtotal: l.subtotal })) }, account).map((f) => [f.field, f.value]),
        );
        const unknown = body.fields.filter((f) => !allowed.has(f));
        if (unknown.length > 0) throw new AppError(400, "UNKNOWN_FIELDS", "Campos no confirmables", { details: { fields: unknown } });
        await tx
          .insert(invoiceFieldConfirmations)
          .values(body.fields.map((f) => ({ companyId: ctx.companyId, invoiceVersionId: versionId, field: f, confirmedValue: allowed.get(f)!, confirmedByUserId: ctx.actor.ref, reason: body.reason })))
          .onConflictDoNothing();
        await recordAudit(tx, { companyId: ctx.companyId, actor: ctx.actor, eventType: "invoice.evidence_confirmed", entityType: "invoice", entityRef: invoiceId, details: { versionId, fields: body.fields, reason: body.reason, textLayer: layer?.status ?? "MISSING" } });
        return { versionId, confirmed: body.fields.map((f) => ({ field: f, value: allowed.get(f) })) };
      });
    },

    listAttachments: (ctx: CompanyCtx, invoiceId: string) =>
      db.select().from(invoiceAttachments).where(and(eq(invoiceAttachments.companyId, ctx.companyId), eq(invoiceAttachments.invoiceId, invoiceId))).orderBy(asc(invoiceAttachments.createdAt)),

    /**
     * Corrección de la MISMA factura comercial: nueva versión inmutable,
     * el original se conserva. Para un número fiscal distinto emitido por el
     * proveedor debe crearse otra factura (replacesInvoiceId).
     */
    async addVersion(ctx: CompanyCtx, invoiceId: string, body: z.infer<typeof invoiceVersionBody>, origin: InvoiceVersionOrigin = "MANUAL_CORRECTION") {
      await db.transaction(async (tx) => {
        const [inv] = await tx
          .select()
          .from(invoices)
          .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, ctx.companyId)))
          .for("update");
        if (!inv) throw notFound("Factura no encontrada");
        let documentId = body.documentId;
        if (documentId) {
          await assertInvoiceDocument(tx, ctx, documentId, invoiceId);
        } else {
          const [cur] = await tx.select({ doc: invoiceVersions.sourceDocumentId }).from(invoiceVersions).where(eq(invoiceVersions.id, inv.currentVersionId!));
          documentId = cur!.doc;
        }
        const version = await insertVersion(tx, ctx, invoiceId, documentId, body.data, origin);
        await recordAudit(tx, {
          companyId: ctx.companyId,
          actor: ctx.actor,
          eventType: "invoice.version_created",
          entityType: "invoice",
          entityRef: invoiceId,
          details: { versionId: version.id, versionNo: version.versionNo, origin, reason: body.reason },
        });
        const number = body.data.supplierInvoiceNumber;
        if (number) {
          if (normalizeInvoiceNumber(number) !== inv.invoiceNumberNormalized) {
            await applyIdentity(tx, ctx, invoiceId, inv.vendorId, number);
          }
        }
      });
      return detail(ctx, invoiceId);
    },
  };
}

export type InvoicesService = ReturnType<typeof createInvoicesService>;
