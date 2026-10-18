import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companyIdColumn, createdAt, money, updatedAt } from "../../shared/db/columns.js";
import { approvalPersonas, expenseCategories } from "../company-config/company-config.schema.js";
import { contracts } from "../contracts/contracts.schema.js";
import { companies } from "../identity/identity.schema.js";
import { vendors } from "../vendors/vendors.schema.js";

export const POLICY_SCOPES = ["COMPANY", "CATEGORY", "VENDOR", "CONTRACT"] as const;
export type PolicyScope = (typeof POLICY_SCOPES)[number];

/** Política por ámbito (ER §F). Se aplican TODAS las que corresponden; la más estricta domina. */
export const companyPolicies = pgTable(
  "company_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyIdColumn(),
    scopeLevel: text("scope_level").$type<PolicyScope>().notNull(),
    categoryId: uuid("category_id"),
    vendorId: uuid("vendor_id"),
    contractId: uuid("contract_id"),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ name: "company_policies_company_fk", columns: [t.companyId], foreignColumns: [companies.id] }).onDelete("restrict"),
    foreignKey({ name: "company_policies_category_fk", columns: [t.companyId, t.categoryId], foreignColumns: [expenseCategories.companyId, expenseCategories.id] }).onDelete("restrict"),
    foreignKey({ name: "company_policies_vendor_fk", columns: [t.companyId, t.vendorId], foreignColumns: [vendors.companyId, vendors.id] }).onDelete("restrict"),
    foreignKey({ name: "company_policies_contract_fk", columns: [t.companyId, t.contractId], foreignColumns: [contracts.companyId, contracts.id] }).onDelete("restrict"),
    unique("company_policies_company_id_key").on(t.companyId, t.id),
    index("company_policies_lookup_idx").on(t.companyId, t.active, t.scopeLevel),
    check("company_policies_scope_valid", sql`${t.scopeLevel} in ('COMPANY', 'CATEGORY', 'VENDOR', 'CONTRACT')`),
    check(
      "company_policies_scope_target",
      sql`case ${t.scopeLevel}
        when 'COMPANY' then ${t.categoryId} is null and ${t.vendorId} is null and ${t.contractId} is null
        when 'CATEGORY' then ${t.categoryId} is not null and ${t.vendorId} is null and ${t.contractId} is null
        when 'VENDOR' then ${t.vendorId} is not null and ${t.categoryId} is null and ${t.contractId} is null
        when 'CONTRACT' then ${t.contractId} is not null and ${t.categoryId} is null and ${t.vendorId} is null
        else false end`,
    ),
  ],
);

/** Condiciones financieras TIPADAS e inmutables (ER §F). Importes en moneda base. */
export const policyVersions = pgTable(
  "policy_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyIdColumn(),
    policyId: uuid("policy_id").notNull(),
    versionNo: integer("version_no").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    autoApprovalLimitBase: money("auto_approval_limit_base"),
    hardInvoiceCapBase: money("hard_invoice_cap_base"),
    publishedByUserId: uuid("published_by_user_id"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "policy_versions_policy_fk", columns: [t.companyId, t.policyId], foreignColumns: [companyPolicies.companyId, companyPolicies.id] }).onDelete("restrict"),
    unique("policy_versions_policy_version_key").on(t.policyId, t.versionNo),
    unique("policy_versions_company_id_key").on(t.companyId, t.id),
    check("policy_versions_version_positive", sql`${t.versionNo} >= 1`),
    check(
      "policy_versions_limits_valid",
      sql`coalesce(${t.autoApprovalLimitBase} >= 0, true) and coalesce(${t.hardInvoiceCapBase} > 0, true)
        and coalesce(${t.autoApprovalLimitBase} <= ${t.hardInvoiceCapBase}, true)`,
    ),
  ],
);

/** Matriz de aprobación por rangos en moneda base (ER §F). Rangos (min, max] sin solaparse (EXCLUDE). */
export const approvalMatrixRules = pgTable(
  "approval_matrix_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyIdColumn(),
    policyVersionId: uuid("policy_version_id").notNull(),
    minAmountExclusive: money("min_amount_exclusive").notNull(),
    /** null = sin tope superior. */
    maxAmountInclusive: money("max_amount_inclusive"),
    personaId: uuid("persona_id").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    foreignKey({ name: "approval_matrix_rules_version_fk", columns: [t.companyId, t.policyVersionId], foreignColumns: [policyVersions.companyId, policyVersions.id] }).onDelete("restrict"),
    foreignKey({ name: "approval_matrix_rules_persona_fk", columns: [t.companyId, t.personaId], foreignColumns: [approvalPersonas.companyId, approvalPersonas.id] }).onDelete("restrict"),
    check(
      "approval_matrix_rules_range_valid",
      sql`${t.minAmountExclusive} >= 0 and coalesce(${t.maxAmountInclusive} > ${t.minAmountExclusive}, true)`,
    ),
  ],
);
