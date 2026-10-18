import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { companyIdColumn, createdAt, updatedAt } from "../../shared/db/columns.js";
import { companies } from "../identity/identity.schema.js";

/** Categoría presupuestaria (ER §A). Una por contrato/factura en P0. */
export const expenseCategories = pgTable(
  "expense_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyIdColumn(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ name: "expense_categories_company_fk", columns: [t.companyId], foreignColumns: [companies.id] }).onDelete("restrict"),
    unique("expense_categories_company_code_key").on(t.companyId, t.code),
    unique("expense_categories_company_id_key").on(t.companyId, t.id),
    check("expense_categories_code_format", sql`${t.code} ~ '^[A-Z0-9_-]{2,40}$'`),
    check("expense_categories_name_not_blank", sql`btrim(${t.name}) <> ''`),
  ],
);

/**
 * Personas aprobadoras SIMULADAS (ER §A). No son usuarios ni roles de login:
 * el evaluador autenticado registra sus respuestas simuladas (B5).
 */
export const approvalPersonas = pgTable(
  "approval_personas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyIdColumn(),
    displayName: text("display_name").notNull(),
    designation: text("designation").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ name: "approval_personas_company_fk", columns: [t.companyId], foreignColumns: [companies.id] }).onDelete("restrict"),
    unique("approval_personas_company_id_key").on(t.companyId, t.id),
    check("approval_personas_name_not_blank", sql`btrim(${t.displayName}) <> '' and btrim(${t.designation}) <> ''`),
  ],
);
