import { sql } from "drizzle-orm";
import { char, check, foreignKey, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companyIdColumn, createdAt } from "../../shared/db/columns.js";
import { documents } from "../documents/documents.schema.js";
import { users } from "../identity/identity.schema.js";
import { invoiceVersions } from "../invoices/invoices.schema.js";

export const TEXT_LAYER_STATUSES = ["TEXT", "NO_TEXT", "UNPARSEABLE"] as const;
export type TextLayerStatus = (typeof TEXT_LAYER_STATUSES)[number];

/**
 * Capa de texto extraída DETERMINISTAMENTE del documento original (no del LLM).
 * TEXT: PDF con texto digital. NO_TEXT: imagen o PDF escaneado (sin texto).
 * UNPARSEABLE: PDF corrupto o fuera de límites. Inmutable.
 */
export const documentTextLayers = pgTable(
  "document_text_layers",
  {
    companyId: companyIdColumn(),
    documentId: uuid("document_id").notNull(),
    status: text("status").$type<TextLayerStatus>().notNull(),
    pageCount: integer("page_count").notNull(),
    extractor: text("extractor").notNull(),
    textSha256: char("text_sha256", { length: 64 }),
    detail: text("detail"),
    extractedAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "document_text_layers_pkey", columns: [t.documentId] }),
    foreignKey({ name: "document_text_layers_document_fk", columns: [t.companyId, t.documentId], foreignColumns: [documents.companyId, documents.id] }).onDelete("restrict"),
    check("document_text_layers_status_valid", sql`${t.status} in ('TEXT', 'NO_TEXT', 'UNPARSEABLE')`),
    check("document_text_layers_pages_valid", sql`${t.pageCount} >= 0`),
  ],
);

/** Texto por página (para localizar y reproducir cada evidencia). Inmutable. */
export const documentTextPages = pgTable(
  "document_text_pages",
  {
    companyId: companyIdColumn(),
    documentId: uuid("document_id").notNull(),
    pageNo: integer("page_no").notNull(),
    text: text("text").notNull(),
  },
  (t) => [
    primaryKey({ name: "document_text_pages_pkey", columns: [t.documentId, t.pageNo] }),
    foreignKey({ name: "document_text_pages_document_fk", columns: [t.companyId, t.documentId], foreignColumns: [documents.companyId, documents.id] }).onDelete("restrict"),
    check("document_text_pages_page_positive", sql`${t.pageNo} >= 1`),
  ],
);

/**
 * Confirmación humana de un campo que NO pudo verificarse por texto (documento
 * sin capa de texto). Ligada a la versión de factura y al valor confirmado;
 * nunca sustituye una discrepancia (NOT_FOUND) en un documento con texto.
 */
export const invoiceFieldConfirmations = pgTable(
  "invoice_field_confirmations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyIdColumn(),
    invoiceVersionId: uuid("invoice_version_id").notNull(),
    field: text("field").notNull(),
    confirmedValue: text("confirmed_value").notNull(),
    confirmedByUserId: uuid("confirmed_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "field_confirmations_version_fk", columns: [t.companyId, t.invoiceVersionId], foreignColumns: [invoiceVersions.companyId, invoiceVersions.id] }).onDelete("restrict"),
    unique("field_confirmations_version_field_key").on(t.invoiceVersionId, t.field),
    check("field_confirmations_field_format", sql`${t.field} ~ '^[a-zA-Z0-9_.\\[\\]]{2,60}$'`),
    check("field_confirmations_reason_not_blank", sql`btrim(${t.reason}) <> ''`),
  ],
);
