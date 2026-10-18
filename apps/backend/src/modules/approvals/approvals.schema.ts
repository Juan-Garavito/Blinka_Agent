import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companyIdColumn, money } from "../../shared/db/columns.js";
import { approvalPersonas } from "../company-config/company-config.schema.js";
import { evaluationFlows, evaluationRuns } from "../evaluations/evaluations.schema.js";
import { users } from "../identity/identity.schema.js";
import { invoiceVersions } from "../invoices/invoices.schema.js";

export const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "SUPERSEDED"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/**
 * Solicitud y resolución SIMULADAS en una sola tabla (ER §E). La persona
 * aprobadora es ficticia (approval_personas); quien registra la respuesta es el
 * evaluador autenticado (resolved_by_user_id): no prueba separación real de deberes.
 * La aprobación queda ligada a la versión de factura y al importe base
 * evaluados (adición física); SUPERSEDED (adición) marca solicitudes reemplazadas
 * por una reevaluación con otra versión/importe.
 */
export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyIdColumn(),
    flowId: uuid("flow_id").notNull(),
    requestedByRunId: uuid("requested_by_run_id").notNull(),
    invoiceVersionId: uuid("invoice_version_id").notNull(),
    personaId: uuid("persona_id").notNull(),
    amountBase: money("amount_base").notNull(),
    status: text("status").$type<ApprovalStatus>().notNull().default("PENDING"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    resolutionReason: text("resolution_reason"),
  },
  (t) => [
    foreignKey({ name: "approval_requests_flow_fk", columns: [t.companyId, t.flowId], foreignColumns: [evaluationFlows.companyId, evaluationFlows.id] }).onDelete("restrict"),
    foreignKey({ name: "approval_requests_run_fk", columns: [t.companyId, t.requestedByRunId], foreignColumns: [evaluationRuns.companyId, evaluationRuns.id] }).onDelete("restrict"),
    foreignKey({ name: "approval_requests_version_fk", columns: [t.companyId, t.invoiceVersionId], foreignColumns: [invoiceVersions.companyId, invoiceVersions.id] }).onDelete("restrict"),
    foreignKey({ name: "approval_requests_persona_fk", columns: [t.companyId, t.personaId], foreignColumns: [approvalPersonas.companyId, approvalPersonas.id] }).onDelete("restrict"),
    unique("approval_requests_company_id_key").on(t.companyId, t.id),
    // Como máximo una solicitud pendiente por trámite.
    uniqueIndex("approval_requests_one_pending_key").on(t.flowId).where(sql`${t.status} = 'PENDING'`),
    index("approval_requests_company_status_idx").on(t.companyId, t.status, t.requestedAt),
    check("approval_requests_status_valid", sql`${t.status} in ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED')`),
    check("approval_requests_amount_positive", sql`${t.amountBase} > 0`),
    check(
      "approval_requests_resolution_consistent",
      sql`case ${t.status}
        when 'PENDING' then ${t.resolvedAt} is null and ${t.resolvedByUserId} is null
        when 'SUPERSEDED' then ${t.resolvedAt} is not null and ${t.resolvedByUserId} is null
        else ${t.resolvedAt} is not null and ${t.resolvedByUserId} is not null and coalesce(btrim(${t.resolutionReason}) <> '', false) end`,
    ),
  ],
);
