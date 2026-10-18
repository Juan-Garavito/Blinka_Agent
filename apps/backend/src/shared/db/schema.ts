/**
 * Punto único de esquema para Drizzle (consulta tipada y drizzle-kit).
 * Cada módulo define sus tablas en `src/modules/<modulo>/<modulo>.schema.ts`
 * y se reexportan aquí.
 */
export * from "../../modules/identity/identity.schema.js";
export * from "../../modules/audit/audit.schema.js";
export * from "../../modules/company-config/company-config.schema.js";
export * from "../../modules/vendors/vendors.schema.js";
export * from "../../modules/documents/documents.schema.js";
export * from "../../modules/contracts/contracts.schema.js";
export * from "../../modules/invoices/invoices.schema.js";
export * from "../../modules/policies/policies.schema.js";
export * from "../../modules/fx/fx.schema.js";
export * from "../../modules/evaluations/evaluations.schema.js";
export * from "../../modules/budgets/budgets.schema.js";
export * from "../../modules/approvals/approvals.schema.js";
export * from "../../modules/evidence/evidence.schema.js";
export * from "../../agents/ai-usage.schema.js";
export * from "./platform.schema.js";
