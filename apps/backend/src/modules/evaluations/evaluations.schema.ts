import { sql } from "drizzle-orm";
import { boolean, char, check, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companyIdColumn, currencyCode, money } from "../../shared/db/columns.js";
import { contractVersions, type BillingType } from "../contracts/contracts.schema.js";
import { documents } from "../documents/documents.schema.js";
import { fxRateSnapshots } from "../fx/fx.schema.js";
import { companies, users } from "../identity/identity.schema.js";
import { invoices, invoiceVersions } from "../invoices/invoices.schema.js";
import { policyVersions } from "../policies/policies.schema.js";
import { vendorBankAccounts } from "../vendors/vendors.schema.js";

/** Decisiones internas del motor (convención fijada por el usuario). */
export const ENGINE_DECISIONS = ["AUTHORIZE", "BLOCK", "ESCALATE"] as const;
export type EngineDecision = (typeof ENGINE_DECISIONS)[number];

/** Seis estados comerciales visibles (ER v1.2). Los estados de cola/etapas NO son estados comerciales. */
export const VISIBLE_OUTCOMES = ["AUTORIZADA", "EN_APROBACION", "EN_CORRECCION", "BLOQUEADA", "RECHAZADA", "ERROR"] as const;
export type VisibleOutcome = (typeof VISIBLE_OUTCOMES)[number];

export const FLOW_TRIGGERS = ["MANUAL", "UPLOAD", "CORRECTION", "APPROVAL_RESOLVED", "RETRY", "REEVALUATION"] as const;
export type FlowTrigger = (typeof FLOW_TRIGGERS)[number];

/**
 * Un trámite de evaluación (ER §D). Abierto mientras termina en EN_APROBACION,
 * EN_CORRECCION o ERROR; se cierra en AUTORIZADA, BLOQUEADA o RECHAZADA y no
 * se reescribe: un intento posterior abre otro flujo con previous_flow_id.
 */
export const evaluationFlows = pgTable(
  "evaluation_flows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyIdColumn(),
    invoiceId: uuid("invoice_id").notNull(),
    previousFlowId: uuid("previous_flow_id"),
    triggerType: text("trigger_type").$type<FlowTrigger>().notNull(),
    justification: text("justification"),
    openedByUserId: uuid("opened_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    terminalStatus: text("terminal_status").$type<VisibleOutcome>(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ name: "evaluation_flows_company_fk", columns: [t.companyId], foreignColumns: [companies.id] }).onDelete("restrict"),
    foreignKey({ name: "evaluation_flows_invoice_fk", columns: [t.companyId, t.invoiceId], foreignColumns: [invoices.companyId, invoices.id] }).onDelete("restrict"),
    foreignKey({ name: "evaluation_flows_previous_fk", columns: [t.companyId, t.previousFlowId], foreignColumns: [t.companyId, t.id] }).onDelete("restrict"),
    unique("evaluation_flows_company_id_key").on(t.companyId, t.id),
    // Como máximo un trámite abierto por factura.
    uniqueIndex("evaluation_flows_one_open_key").on(t.invoiceId).where(sql`${t.closedAt} is null`),
    index("evaluation_flows_invoice_idx").on(t.companyId, t.invoiceId, t.openedAt),
    check("evaluation_flows_trigger_valid", sql`${t.triggerType} in ('MANUAL', 'UPLOAD', 'CORRECTION', 'APPROVAL_RESOLVED', 'RETRY', 'REEVALUATION')`),
    check("evaluation_flows_terminal_valid", sql`${t.terminalStatus} is null or ${t.terminalStatus} in ('AUTORIZADA', 'BLOQUEADA', 'RECHAZADA')`),
    check("evaluation_flows_closed_consistent", sql`(${t.closedAt} is null) = (${t.terminalStatus} is null)`),
  ],
);

export const RUN_STATUSES = ["RUNNING", "COMPLETED", "SUPERSEDED"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * Una ejecución (ER §D). Se crea RUNNING al iniciar (las etapas de B4 la
 * referencian) y se finaliza una sola vez; después es inmutable (trigger).
 * Una corrida AUTHORIZE sin reserva confirmada no puede confirmarse (trigger diferido).
 */
export const evaluationRuns = pgTable(
  "evaluation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyIdColumn(),
    flowId: uuid("flow_id").notNull(),
    invoiceVersionId: uuid("invoice_version_id").notNull(),
    runNo: integer("run_no").notNull(),
    status: text("status").$type<RunStatus>().notNull().default("RUNNING"),
    detectedBillingType: text("detected_billing_type").$type<BillingType | "UNKNOWN" | "MIXED">(),
    selectedContractVersionId: uuid("selected_contract_version_id"),
    matchedBankAccountId: uuid("matched_bank_account_id"),
    fxRateSnapshotId: uuid("fx_rate_snapshot_id").references(() => fxRateSnapshots.id, { onDelete: "restrict" }),
    amountBase: money("amount_base"),
    baseCurrency: currencyCode("base_currency"),
    decision: text("decision").$type<EngineDecision>(),
    visibleOutcome: text("visible_outcome").$type<VisibleOutcome>(),
    reasonCode: text("reason_code"),
    engineVersion: text("engine_version"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ name: "evaluation_runs_flow_fk", columns: [t.companyId, t.flowId], foreignColumns: [evaluationFlows.companyId, evaluationFlows.id] }).onDelete("restrict"),
    foreignKey({ name: "evaluation_runs_version_fk", columns: [t.companyId, t.invoiceVersionId], foreignColumns: [invoiceVersions.companyId, invoiceVersions.id] }).onDelete("restrict"),
    foreignKey({ name: "evaluation_runs_contract_version_fk", columns: [t.companyId, t.selectedContractVersionId], foreignColumns: [contractVersions.companyId, contractVersions.id] }).onDelete("restrict"),
    foreignKey({ name: "evaluation_runs_bank_account_fk", columns: [t.companyId, t.matchedBankAccountId], foreignColumns: [vendorBankAccounts.companyId, vendorBankAccounts.id] }).onDelete("restrict"),
    unique("evaluation_runs_flow_run_key").on(t.flowId, t.runNo),
    unique("evaluation_runs_company_id_key").on(t.companyId, t.id),
    index("evaluation_runs_flow_idx").on(t.companyId, t.flowId, t.runNo),
    check("evaluation_runs_status_valid", sql`${t.status} in ('RUNNING', 'COMPLETED', 'SUPERSEDED')`),
    check("evaluation_runs_decision_valid", sql`${t.decision} is null or ${t.decision} in ('AUTHORIZE', 'BLOCK', 'ESCALATE')`),
    check(
      "evaluation_runs_outcome_valid",
      sql`${t.visibleOutcome} is null or ${t.visibleOutcome} in ('AUTORIZADA', 'EN_APROBACION', 'EN_CORRECCION', 'BLOQUEADA', 'RECHAZADA', 'ERROR')`,
    ),
    // Correspondencia decisión ↔ estado visible (ER §5.8). ERROR es técnico (sin decisión);
    // RECHAZADA es una resolución humana (sin decisión del motor).
    check(
      "evaluation_runs_decision_outcome_consistent",
      sql`case
        when ${t.status} <> 'COMPLETED' then ${t.decision} is null and ${t.visibleOutcome} is null
        when ${t.visibleOutcome} = 'AUTORIZADA' then ${t.decision} is not distinct from 'AUTHORIZE'
        when ${t.visibleOutcome} = 'BLOQUEADA' then ${t.decision} is not distinct from 'BLOCK'
        when ${t.visibleOutcome} in ('EN_APROBACION', 'EN_CORRECCION') then ${t.decision} is not distinct from 'ESCALATE'
        when ${t.visibleOutcome} in ('ERROR', 'RECHAZADA') then ${t.decision} is null
        else false end`,
    ),
    check("evaluation_runs_completed_fields", sql`${t.status} <> 'COMPLETED' or (${t.visibleOutcome} is not null and ${t.reasonCode} is not null and ${t.evaluatedAt} is not null)`),
    check("evaluation_runs_authorize_requires_contract", sql`${t.decision} is distinct from 'AUTHORIZE' or (${t.selectedContractVersionId} is not null and ${t.matchedBankAccountId} is not null and ${t.amountBase} is not null)`),
  ],
);

export const CHECK_OUTCOMES = ["PASS", "FAIL", "UNKNOWN"] as const;
export type CheckOutcome = (typeof CHECK_OUTCOMES)[number];

/**
 * Efecto de una comprobación no superada: BLOCK (prohibición dura verificada),
 * CORRECTION (dato faltante o discrepancia corregible), APPROVAL (requiere
 * persona aprobadora), ENABLEMENT (requiere habilitar proveedor/cuenta; aprobar
 * la factura NO basta), ERROR (falla técnica), INFO (solo informativa).
 */
export const CHECK_EFFECTS = ["BLOCK", "CORRECTION", "APPROVAL", "ENABLEMENT", "ERROR", "INFO"] as const;
export type CheckEffect = (typeof CHECK_EFFECTS)[number];

/** Una comprobación por regla (ER §D), con valores estructurados. Inmutable. */
export const evaluationChecks = pgTable(
  "evaluation_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyIdColumn(),
    evaluationRunId: uuid("evaluation_run_id").notNull(),
    seq: integer("seq").notNull(),
    ruleCode: text("rule_code").notNull(),
    outcome: text("outcome").$type<CheckOutcome>().notNull(),
    effect: text("effect").$type<CheckEffect>().notNull(),
    observedText: text("observed_text"),
    expectedText: text("expected_text"),
    observedAmount: money("observed_amount"),
    expectedAmount: money("expected_amount"),
    currency: currencyCode("currency"),
    reason: text("reason").notNull(),
  },
  (t) => [
    foreignKey({ name: "evaluation_checks_run_fk", columns: [t.companyId, t.evaluationRunId], foreignColumns: [evaluationRuns.companyId, evaluationRuns.id] }).onDelete("restrict"),
    unique("evaluation_checks_run_seq_key").on(t.evaluationRunId, t.seq),
    unique("evaluation_checks_company_id_key").on(t.companyId, t.id),
    check("evaluation_checks_outcome_valid", sql`${t.outcome} in ('PASS', 'FAIL', 'UNKNOWN')`),
    check("evaluation_checks_effect_valid", sql`${t.effect} in ('BLOCK', 'CORRECTION', 'APPROVAL', 'ENABLEMENT', 'ERROR', 'INFO')`),
    check("evaluation_checks_rule_format", sql`${t.ruleCode} ~ '^[A-Z][A-Z0-9_]{2,60}$'`),
  ],
);

/** Versiones de política realmente aplicadas por evaluación (ER §F, N:M). */
export const evaluationAppliedPolicies = pgTable(
  "evaluation_applied_policies",
  {
    companyId: companyIdColumn(),
    evaluationRunId: uuid("evaluation_run_id").notNull(),
    policyVersionId: uuid("policy_version_id").notNull(),
    applicabilityReason: text("applicability_reason").notNull(),
  },
  (t) => [
    primaryKey({ name: "evaluation_applied_policies_pkey", columns: [t.evaluationRunId, t.policyVersionId] }),
    foreignKey({ name: "evaluation_applied_policies_run_fk", columns: [t.companyId, t.evaluationRunId], foreignColumns: [evaluationRuns.companyId, evaluationRuns.id] }).onDelete("restrict"),
    foreignKey({ name: "evaluation_applied_policies_version_fk", columns: [t.companyId, t.policyVersionId], foreignColumns: [policyVersions.companyId, policyVersions.id] }).onDelete("restrict"),
  ],
);

export const STAGE_CODES = ["EXTRACT_CLASSIFY", "CONTRACT_MATCH", "CONTRACT_VALIDATE", "FINANCIAL_DECISION"] as const;
export type StageCode = (typeof STAGE_CODES)[number];
export const STAGE_STATUSES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "REUSED"] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

/**
 * Un intento técnico de una etapa (ER §D, ARCH-011). Registra EJECUCIÓN, no
 * copia resultados: `result_ref` apunta a la entidad producida (p. ej. la
 * invoice_version de extracción). Reutilizable solo si coincide la huella.
 * Terminado (SUCCEEDED/FAILED/REUSED) es histórico e inmutable (trigger).
 */
export const agentStageRuns = pgTable(
  "agent_stage_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyIdColumn(),
    evaluationRunId: uuid("evaluation_run_id").notNull(),
    stageCode: text("stage_code").$type<StageCode>().notNull(),
    attemptNo: integer("attempt_no").notNull(),
    status: text("status").$type<StageStatus>().notNull(),
    inputFingerprint: char("input_fingerprint", { length: 64 }).notNull(),
    reusedFromStageRunId: uuid("reused_from_stage_run_id"),
    resultRef: text("result_ref"),
    errorCode: text("error_code"),
    errorRetryable: boolean("error_retryable"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ name: "agent_stage_runs_run_fk", columns: [t.companyId, t.evaluationRunId], foreignColumns: [evaluationRuns.companyId, evaluationRuns.id] }).onDelete("restrict"),
    foreignKey({ name: "agent_stage_runs_reused_fk", columns: [t.companyId, t.reusedFromStageRunId], foreignColumns: [t.companyId, t.id] }).onDelete("restrict"),
    unique("agent_stage_runs_attempt_key").on(t.evaluationRunId, t.stageCode, t.attemptNo),
    unique("agent_stage_runs_company_id_key").on(t.companyId, t.id),
    index("agent_stage_runs_fingerprint_idx").on(t.companyId, t.stageCode, t.inputFingerprint, t.status),
    check("agent_stage_runs_stage_valid", sql`${t.stageCode} in ('EXTRACT_CLASSIFY', 'CONTRACT_MATCH', 'CONTRACT_VALIDATE', 'FINANCIAL_DECISION')`),
    check("agent_stage_runs_status_valid", sql`${t.status} in ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'REUSED')`),
    check("agent_stage_runs_attempt_positive", sql`${t.attemptNo} >= 1`),
    check("agent_stage_runs_fingerprint_hex", sql`${t.inputFingerprint} ~ '^[0-9a-f]{64}$'`),
    check("agent_stage_runs_reuse_consistent", sql`(${t.status} = 'REUSED') = (${t.reusedFromStageRunId} is not null)`),
    check("agent_stage_runs_failure_consistent", sql`(${t.status} = 'FAILED') = (${t.errorCode} is not null)`),
  ],
);

/** Contratos examinados por una evaluación (ER §D), con el motivo de selección o descarte. */
export const evaluationContractCandidates = pgTable(
  "evaluation_contract_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyIdColumn(),
    evaluationRunId: uuid("evaluation_run_id").notNull(),
    contractVersionId: uuid("contract_version_id").notNull(),
    typeMatch: boolean("type_match").notNull(),
    referenceMatch: boolean("reference_match"),
    selected: boolean("selected").notNull(),
    reason: text("reason").notNull(),
  },
  (t) => [
    foreignKey({ name: "evaluation_candidates_run_fk", columns: [t.companyId, t.evaluationRunId], foreignColumns: [evaluationRuns.companyId, evaluationRuns.id] }).onDelete("restrict"),
    foreignKey({ name: "evaluation_candidates_version_fk", columns: [t.companyId, t.contractVersionId], foreignColumns: [contractVersions.companyId, contractVersions.id] }).onDelete("restrict"),
    unique("evaluation_candidates_run_version_key").on(t.evaluationRunId, t.contractVersionId),
    unique("evaluation_candidates_company_id_key").on(t.companyId, t.id),
  ],
);

export const EVIDENCE_STATUSES = ["MODEL_REPORTED", "STRUCTURED_MATCH", "USER_PROVIDED", "REJECTED", "TEXT_VERIFIED", "NOT_FOUND", "UNVERIFIABLE", "HUMAN_CONFIRMED"] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

/**
 * Procedencia concreta de un dato o comprobación (ER §D).
 * TEXT_VERIFIED: valor localizado en la capa de texto del documento original (página y posición).
 * NOT_FOUND: el documento tiene texto pero el valor no aparece (posible dato inventado).
 * UNVERIFIABLE: documento sin capa de texto (imagen/escaneo). HUMAN_CONFIRMED: confirmado por persona.
 * MODEL_REPORTED / REJECTED: fragmento citado por el modelo, sin verificar / no encontrado en el texto.
 * Solo TEXT_VERIFIED o HUMAN_CONFIRMED satisfacen la evidencia obligatoria.
 */
export const evaluationEvidence = pgTable(
  "evaluation_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyIdColumn(),
    evaluationRunId: uuid("evaluation_run_id").notNull(),
    evaluationCheckId: uuid("evaluation_check_id"),
    contractCandidateId: uuid("contract_candidate_id"),
    documentId: uuid("document_id"),
    sourceField: text("source_field"),
    pageNumber: integer("page_number"),
    /** Posición del valor en el texto de la página (caracteres) cuando se verificó por texto. */
    charStart: integer("char_start"),
    charEnd: integer("char_end"),
    clauseRef: text("clause_ref"),
    excerpt: text("excerpt"),
    verificationStatus: text("verification_status").$type<EvidenceStatus>().notNull(),
  },
  (t) => [
    foreignKey({ name: "evaluation_evidence_run_fk", columns: [t.companyId, t.evaluationRunId], foreignColumns: [evaluationRuns.companyId, evaluationRuns.id] }).onDelete("restrict"),
    foreignKey({ name: "evaluation_evidence_check_fk", columns: [t.companyId, t.evaluationCheckId], foreignColumns: [evaluationChecks.companyId, evaluationChecks.id] }).onDelete("restrict"),
    foreignKey({ name: "evaluation_evidence_candidate_fk", columns: [t.companyId, t.contractCandidateId], foreignColumns: [evaluationContractCandidates.companyId, evaluationContractCandidates.id] }).onDelete("restrict"),
    foreignKey({ name: "evaluation_evidence_document_fk", columns: [t.companyId, t.documentId], foreignColumns: [documents.companyId, documents.id] }).onDelete("restrict"),
    index("evaluation_evidence_run_idx").on(t.companyId, t.evaluationRunId),
    check(
      "evaluation_evidence_status_valid",
      sql`${t.verificationStatus} in ('MODEL_REPORTED', 'STRUCTURED_MATCH', 'USER_PROVIDED', 'REJECTED', 'TEXT_VERIFIED', 'NOT_FOUND', 'UNVERIFIABLE', 'HUMAN_CONFIRMED')`,
    ),
    check("evaluation_evidence_excerpt_length", sql`${t.excerpt} is null or length(${t.excerpt}) <= 500`),
    check("evaluation_evidence_page_positive", sql`${t.pageNumber} is null or ${t.pageNumber} >= 1`),
  ],
);
