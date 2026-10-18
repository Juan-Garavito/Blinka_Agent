import { sql } from "drizzle-orm";
import { char, check, foreignKey, index, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companyIdColumn, createdAt, currencyCode, updatedAt } from "../../shared/db/columns.js";
import { companies } from "../identity/identity.schema.js";

export const VENDOR_STATUSES = ["PENDING", "AUTHORIZED", "BLOCKED"] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

/** Proveedor (ER §B). Su autorización es independiente de la de sus cuentas. */
export const vendors = pgTable(
  "vendors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyIdColumn(),
    legalName: text("legal_name").notNull(),
    /** Identificación fiscal normalizada (mayúsculas, solo alfanuméricos). */
    taxReference: text("tax_reference"),
    status: text("status").$type<VendorStatus>().notNull().default("PENDING"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ name: "vendors_company_fk", columns: [t.companyId], foreignColumns: [companies.id] }).onDelete("restrict"),
    unique("vendors_company_id_key").on(t.companyId, t.id),
    uniqueIndex("vendors_company_tax_reference_key").on(t.companyId, t.taxReference).where(sql`${t.taxReference} is not null`),
    check("vendors_status_valid", sql`${t.status} in ('PENDING', 'AUTHORIZED', 'BLOCKED')`),
    check("vendors_legal_name_not_blank", sql`btrim(${t.legalName}) <> ''`),
    check("vendors_tax_reference_normalized", sql`${t.taxReference} is null or ${t.taxReference} ~ '^[A-Z0-9]{3,40}$'`),
  ],
);

/**
 * Cuenta de destino de pagos (ER §B). Solo se guarda una huella HMAC-SHA256
 * del número normalizado y una máscara; nunca el número completo.
 */
export const vendorBankAccounts = pgTable(
  "vendor_bank_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyIdColumn(),
    vendorId: uuid("vendor_id").notNull(),
    country: char("country", { length: 2 }).notNull(),
    currency: currencyCode("currency").notNull(),
    accountFingerprint: char("account_fingerprint", { length: 64 }).notNull(),
    accountMask: text("account_mask").notNull(),
    status: text("status").$type<VendorStatus>().notNull().default("PENDING"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "vendor_bank_accounts_vendor_fk",
      columns: [t.companyId, t.vendorId],
      foreignColumns: [vendors.companyId, vendors.id],
    }).onDelete("restrict"),
    unique("vendor_bank_accounts_company_id_key").on(t.companyId, t.id),
    unique("vendor_bank_accounts_vendor_fingerprint_key").on(t.companyId, t.vendorId, t.accountFingerprint),
    index("vendor_bank_accounts_fingerprint_idx").on(t.companyId, t.accountFingerprint),
    check("vendor_bank_accounts_status_valid", sql`${t.status} in ('PENDING', 'AUTHORIZED', 'BLOCKED')`),
    check("vendor_bank_accounts_country_iso", sql`${t.country} ~ '^[A-Z]{2}$'`),
    check("vendor_bank_accounts_currency_iso", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("vendor_bank_accounts_fingerprint_hex", sql`${t.accountFingerprint} ~ '^[0-9a-f]{64}$'`),
    check("vendor_bank_accounts_mask_format", sql`${t.accountMask} ~ '^\\*{4}[A-Z0-9]{2,4}$'`),
  ],
);
