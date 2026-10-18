import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companyIdColumn, createdAt, currencyCode, money, quantity, unitPrice, updatedAt } from "../../shared/db/columns.js";
import { expenseCategories } from "../company-config/company-config.schema.js";
import { documents } from "../documents/documents.schema.js";
import { users } from "../identity/identity.schema.js";
import { vendors } from "../vendors/vendors.schema.js";

export const BILLING_TYPES = ["RECURRING", "HOURLY", "MILESTONE", "PURCHASE_ORDER"] as const;
export type BillingType = (typeof BILLING_TYPES)[number];

export const CONTRACT_STATUSES = ["ACTIVE", "TERMINATED"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_VERSION_STATUSES = ["DRAFT", "CONFIRMED", "REJECTED"] as const;
export type ContractVersionStatus = (typeof CONTRACT_VERSION_STATUSES)[number];

/** MANUAL: registrado por una persona. AI_SUGGESTED: propuesto por extracción; nunca elegible sin confirmación humana. */
export const CONTRACT_VERSION_ORIGINS = ["MANUAL", "AI_SUGGESTED"] as const;
export type ContractVersionOrigin = (typeof CONTRACT_VERSION_ORIGINS)[number];

export const BILLING_FREQUENCIES = ["MONTHLY", "QUARTERLY", "ANNUAL"] as const;
export type BillingFrequency = (typeof BILLING_FREQUENCIES)[number];

export const ITEM_KINDS = ["FIXED_FEE", "HOURLY_RATE", "MILESTONE", "PO_LINE"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** Acuerdo con un proveedor (ER §B). La categoría propone el destino presupuestario. */
export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyIdColumn(),
    vendorId: uuid("vendor_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    /** Referencia del contrato; en PURCHASE_ORDER es el número de OC. */
    contractRef: text("contract_ref").notNull(),
    billingType: text("billing_type").$type<BillingType>().notNull(),
    status: text("status").$type<ContractStatus>().notNull().default("ACTIVE"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ name: "contracts_vendor_fk", columns: [t.companyId, t.vendorId], foreignColumns: [vendors.companyId, vendors.id] }).onDelete(
      "restrict",
    ),
    foreignKey({
      name: "contracts_category_fk",
      columns: [t.companyId, t.categoryId],
      foreignColumns: [expenseCategories.companyId, expenseCategories.id],
    }).onDelete("restrict"),
    unique("contracts_company_id_key").on(t.companyId, t.id),
    unique("contracts_vendor_ref_key").on(t.companyId, t.vendorId, t.contractRef),
    check("contracts_billing_type_valid", sql`${t.billingType} in ('RECURRING', 'HOURLY', 'MILESTONE', 'PURCHASE_ORDER')`),
    check("contracts_status_valid", sql`${t.status} in ('ACTIVE', 'TERMINATED')`),
    check("contracts_ref_not_blank", sql`btrim(${t.contractRef}) <> ''`),
  ],
);

/**
 * Versión de condiciones (ER §B). Solo CONFIRMED (por persona autenticada) es
 * elegible para autorizar. Inmutable salvo en DRAFT (trigger). Las vigencias de
 * versiones CONFIRMED de un mismo contrato no pueden solaparse (EXCLUDE).
 * `company_id` se añade al ER para FKs compuestas con documentos.
 */
export const contractVersions = pgTable(
  "contract_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyIdColumn(),
    contractId: uuid("contract_id").notNull(),
    versionNo: integer("version_no").notNull(),
    currency: currencyCode("currency").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    billingFrequency: text("billing_frequency").$type<BillingFrequency>(),
    fixedPeriodAmount: money("fixed_period_amount"),
    quantityCapPerPeriod: quantity("quantity_cap_per_period"),
    status: text("status").$type<ContractVersionStatus>().notNull().default("DRAFT"),
    origin: text("origin").$type<ContractVersionOrigin>().notNull(),
    sourceDocumentId: uuid("source_document_id"),
    confirmedByUserId: uuid("confirmed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "contract_versions_contract_fk",
      columns: [t.companyId, t.contractId],
      foreignColumns: [contracts.companyId, contracts.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "contract_versions_document_fk",
      columns: [t.companyId, t.sourceDocumentId],
      foreignColumns: [documents.companyId, documents.id],
    }).onDelete("restrict"),
    unique("contract_versions_company_id_key").on(t.companyId, t.id),
    unique("contract_versions_contract_version_key").on(t.contractId, t.versionNo),
    index("contract_versions_lookup_idx").on(t.companyId, t.contractId, t.status, t.effectiveFrom),
    check("contract_versions_version_positive", sql`${t.versionNo} >= 1`),
    check("contract_versions_currency_iso", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("contract_versions_period_valid", sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`),
    check("contract_versions_status_valid", sql`${t.status} in ('DRAFT', 'CONFIRMED', 'REJECTED')`),
    check("contract_versions_origin_valid", sql`${t.origin} in ('MANUAL', 'AI_SUGGESTED')`),
    check(
      "contract_versions_frequency_valid",
      sql`${t.billingFrequency} is null or ${t.billingFrequency} in ('MONTHLY', 'QUARTERLY', 'ANNUAL')`,
    ),
    check("contract_versions_amounts_positive", sql`coalesce(${t.fixedPeriodAmount} > 0, true) and coalesce(${t.quantityCapPerPeriod} > 0, true)`),
    check(
      "contract_versions_confirmation_consistent",
      sql`(${t.status} = 'CONFIRMED') = (${t.confirmedByUserId} is not null and ${t.confirmedAt} is not null)`,
    ),
  ],
);

/** Tarifas, entregables o líneas de OC de una versión (ER §B). Inmutables fuera de DRAFT. */
export const contractItems = pgTable(
  "contract_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractVersionId: uuid("contract_version_id")
      .notNull()
      .references(() => contractVersions.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    description: text("description").notNull(),
    itemKind: text("item_kind").$type<ItemKind>().notNull(),
    unit: text("unit"),
    agreedQuantity: quantity("agreed_quantity"),
    unitPrice: unitPrice("unit_price"),
    milestoneRef: text("milestone_ref"),
    agreedAmount: money("agreed_amount"),
  },
  (t) => [
    unique("contract_items_version_code_key").on(t.contractVersionId, t.code),
    check("contract_items_kind_valid", sql`${t.itemKind} in ('FIXED_FEE', 'HOURLY_RATE', 'MILESTONE', 'PO_LINE')`),
    check("contract_items_code_format", sql`${t.code} ~ '^[A-Za-z0-9._-]{1,40}$'`),
    // Campos obligatorios por tipo de ítem (validadores tipados por modalidad, ER §B).
    check(
      "contract_items_fields_by_kind",
      sql`case ${t.itemKind}
        when 'HOURLY_RATE' then ${t.unit} is not null and ${t.unitPrice} is not null
        when 'MILESTONE' then ${t.milestoneRef} is not null and ${t.agreedAmount} is not null
        when 'PO_LINE' then ${t.agreedQuantity} is not null and ${t.unitPrice} is not null
        when 'FIXED_FEE' then ${t.agreedAmount} is not null
        else false end`,
    ),
    check(
      "contract_items_amounts_positive",
      sql`coalesce(${t.unitPrice} > 0, true) and coalesce(${t.agreedQuantity} > 0, true) and coalesce(${t.agreedAmount} > 0, true)`,
    ),
  ],
);
