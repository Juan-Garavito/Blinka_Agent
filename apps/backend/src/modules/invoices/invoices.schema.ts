import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companyIdColumn, createdAt, currencyCode, money, quantity, unitPrice } from "../../shared/db/columns.js";
import { expenseCategories } from "../company-config/company-config.schema.js";
import { documents } from "../documents/documents.schema.js";
import { users } from "../identity/identity.schema.js";
import { vendors } from "../vendors/vendors.schema.js";

/**
 * Identidad interna estable de una factura comercial (ER §C). Proveedor
 * obligatorio. La identidad externa (empresa, proveedor, número normalizado)
 * es única cuando se conoce. Una factura con el mismo número que otra queda
 * enlazada en `duplicate_of_invoice_id` sin reclamar la identidad (desviación
 * física documentada: permite registrar y BLOQUEAR el duplicado).
 */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyIdColumn(),
    vendorId: uuid("vendor_id").notNull(),
    categoryId: uuid("category_id"),
    invoiceNumberNormalized: text("invoice_number_normalized"),
    currentVersionId: uuid("current_version_id"),
    replacesInvoiceId: uuid("replaces_invoice_id"),
    duplicateOfInvoiceId: uuid("duplicate_of_invoice_id"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "invoices_vendor_fk", columns: [t.companyId, t.vendorId], foreignColumns: [vendors.companyId, vendors.id] }).onDelete("restrict"),
    foreignKey({
      name: "invoices_category_fk",
      columns: [t.companyId, t.categoryId],
      foreignColumns: [expenseCategories.companyId, expenseCategories.id],
    }).onDelete("restrict"),
    foreignKey({ name: "invoices_replaces_fk", columns: [t.companyId, t.replacesInvoiceId], foreignColumns: [t.companyId, t.id] }).onDelete(
      "restrict",
    ),
    foreignKey({ name: "invoices_duplicate_of_fk", columns: [t.companyId, t.duplicateOfInvoiceId], foreignColumns: [t.companyId, t.id] }).onDelete(
      "restrict",
    ),
    // FK invoices_current_version_fk (current_version_id, id) → invoice_versions(id, invoice_id):
    // se declara en la migración SQL 0005 para evitar la referencia circular de tipos.
    unique("invoices_company_id_key").on(t.companyId, t.id),
    uniqueIndex("invoices_identity_key")
      .on(t.companyId, t.vendorId, t.invoiceNumberNormalized)
      .where(sql`${t.invoiceNumberNormalized} is not null`),
    index("invoices_company_created_idx").on(t.companyId, t.createdAt),
    check("invoices_number_normalized_format", sql`${t.invoiceNumberNormalized} is null or ${t.invoiceNumberNormalized} ~ '^[A-Z0-9]{1,60}$'`),
    check("invoices_not_self_referencing", sql`coalesce(${t.replacesInvoiceId} <> ${t.id}, true) and coalesce(${t.duplicateOfInvoiceId} <> ${t.id}, true)`),
    check("invoices_duplicate_has_no_identity", sql`${t.duplicateOfInvoiceId} is null or ${t.invoiceNumberNormalized} is null`),
  ],
);

export const INVOICE_VERSION_ORIGINS = ["UPLOAD", "EXTRACTION", "MANUAL_CORRECTION"] as const;
export type InvoiceVersionOrigin = (typeof INVOICE_VERSION_ORIGINS)[number];

/**
 * Datos de una versión de la misma factura comercial (ER §C). Inmutable
 * (trigger). Los campos financieros pueden faltar: un dato crítico ausente
 * lleva a EN_CORRECCION, nunca se supone.
 */
export const invoiceVersions = pgTable(
  "invoice_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyIdColumn(),
    invoiceId: uuid("invoice_id").notNull(),
    versionNo: integer("version_no").notNull(),
    origin: text("origin").$type<InvoiceVersionOrigin>().notNull(),
    sourceDocumentId: uuid("source_document_id").notNull(),
    supplierInvoiceNumber: text("supplier_invoice_number"),
    /** Identificación fiscal del emisor tal como aparece en el documento. */
    issuerTaxReference: text("issuer_tax_reference"),
    issueDate: date("issue_date"),
    dueDate: date("due_date"),
    servicePeriodStart: date("service_period_start"),
    servicePeriodEnd: date("service_period_end"),
    originalCurrency: currencyCode("original_currency"),
    subtotal: money("subtotal"),
    taxes: money("taxes"),
    discounts: money("discounts"),
    totalAmount: money("total_amount"),
    /** Referencia de contrato/OC citada en la factura, si existe. */
    contractRefCited: text("contract_ref_cited"),
    paymentDestinationRaw: text("payment_destination_raw"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "invoice_versions_invoice_fk",
      columns: [t.companyId, t.invoiceId],
      foreignColumns: [invoices.companyId, invoices.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "invoice_versions_document_fk",
      columns: [t.companyId, t.sourceDocumentId],
      foreignColumns: [documents.companyId, documents.id],
    }).onDelete("restrict"),
    unique("invoice_versions_invoice_version_key").on(t.invoiceId, t.versionNo),
    unique("invoice_versions_id_invoice_key").on(t.id, t.invoiceId),
    unique("invoice_versions_company_id_key").on(t.companyId, t.id),
    index("invoice_versions_document_idx").on(t.companyId, t.sourceDocumentId),
    check("invoice_versions_version_positive", sql`${t.versionNo} >= 1`),
    check("invoice_versions_origin_valid", sql`${t.origin} in ('UPLOAD', 'EXTRACTION', 'MANUAL_CORRECTION')`),
    check("invoice_versions_currency_iso", sql`${t.originalCurrency} is null or ${t.originalCurrency} ~ '^[A-Z]{3}$'`),
    check("invoice_versions_period_valid", sql`coalesce(${t.servicePeriodEnd} >= ${t.servicePeriodStart}, true)`),
    check(
      "invoice_versions_amounts_non_negative",
      sql`coalesce(${t.subtotal} >= 0, true) and coalesce(${t.taxes} >= 0, true) and coalesce(${t.discounts} >= 0, true) and coalesce(${t.totalAmount} >= 0, true)`,
    ),
  ],
);

/** Conceptos facturados por versión (ER §C). `item_ref` (hito/código de OC) es una adición física. */
export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceVersionId: uuid("invoice_version_id")
      .notNull()
      .references(() => invoiceVersions.id, { onDelete: "restrict" }),
    lineNo: integer("line_no").notNull(),
    concept: text("concept").notNull(),
    itemRef: text("item_ref"),
    quantity: quantity("quantity"),
    unit: text("unit"),
    unitPrice: unitPrice("unit_price"),
    subtotal: money("subtotal").notNull(),
    taxAmount: money("tax_amount"),
  },
  (t) => [
    unique("invoice_lines_version_line_key").on(t.invoiceVersionId, t.lineNo),
    check("invoice_lines_line_positive", sql`${t.lineNo} >= 1`),
    check("invoice_lines_concept_not_blank", sql`btrim(${t.concept}) <> ''`),
    check(
      "invoice_lines_amounts_valid",
      sql`${t.subtotal} >= 0 and coalesce(${t.quantity} > 0, true) and coalesce(${t.unitPrice} >= 0, true) and coalesce(${t.taxAmount} >= 0, true)`,
    ),
  ],
);

export const ATTACHMENT_PURPOSES = ["TIMESHEET", "MILESTONE_ACCEPTANCE", "DELIVERY_NOTE", "OTHER"] as const;
export type AttachmentPurpose = (typeof ATTACHMENT_PURPOSES)[number];

/**
 * Evidencias vinculadas a una factura antes de evaluarla (hoja de horas,
 * acta de aceptación de hito, remisión). Adición física al ER v1.2: el ER
 * referencia evidencias desde evaluation_evidence, pero la validación por
 * modalidad necesita saber qué respaldo aportó el usuario. Append-only.
 */
export const invoiceAttachments = pgTable(
  "invoice_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyIdColumn(),
    invoiceId: uuid("invoice_id").notNull(),
    documentId: uuid("document_id").notNull(),
    purpose: text("purpose").$type<AttachmentPurpose>().notNull(),
    milestoneRef: text("milestone_ref"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "invoice_attachments_invoice_fk", columns: [t.companyId, t.invoiceId], foreignColumns: [invoices.companyId, invoices.id] }).onDelete(
      "restrict",
    ),
    foreignKey({ name: "invoice_attachments_document_fk", columns: [t.companyId, t.documentId], foreignColumns: [documents.companyId, documents.id] }).onDelete(
      "restrict",
    ),
    unique("invoice_attachments_invoice_document_key").on(t.invoiceId, t.documentId),
    check("invoice_attachments_purpose_valid", sql`${t.purpose} in ('TIMESHEET', 'MILESTONE_ACCEPTANCE', 'DELIVERY_NOTE', 'OTHER')`),
  ],
);
