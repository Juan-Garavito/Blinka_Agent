import { sql } from "drizzle-orm";
import { bigint, char, check, foreignKey, index, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companyIdColumn, createdAt } from "../../shared/db/columns.js";
import { companies, users } from "../identity/identity.schema.js";

export const DOCUMENT_KINDS = ["INVOICE", "CONTRACT", "EVIDENCE"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;
export type DocumentMimeType = (typeof DOCUMENT_MIME_TYPES)[number];

/**
 * Archivo privado original (ER §B). `storage_key` lo genera el backend
 * (nunca el cliente) y no es una URL. Inmutable: un trigger impide UPDATE/DELETE.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyIdColumn(),
    kind: text("kind").$type<DocumentKind>().notNull(),
    storageKey: text("storage_key").notNull(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").$type<DocumentMimeType>().notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "documents_company_fk", columns: [t.companyId], foreignColumns: [companies.id] }).onDelete("restrict"),
    unique("documents_company_id_key").on(t.companyId, t.id),
    uniqueIndex("documents_storage_key_key").on(t.storageKey),
    index("documents_company_sha256_idx").on(t.companyId, t.sha256),
    check("documents_kind_valid", sql`${t.kind} in ('INVOICE', 'CONTRACT', 'EVIDENCE')`),
    check("documents_mime_valid", sql`${t.mimeType} in ('application/pdf', 'image/png', 'image/jpeg')`),
    check("documents_size_positive", sql`${t.sizeBytes} > 0`),
    check("documents_sha256_hex", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check("documents_storage_key_format", sql`${t.storageKey} ~ '^companies/[0-9a-f-]{36}/documents/[0-9a-f-]{36}$'`),
    check("documents_original_name_safe", sql`${t.originalName} ~ '^[^/\\\\]{1,120}$'`),
  ],
);
