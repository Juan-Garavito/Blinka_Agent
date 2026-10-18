import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { companyIdColumn, createdAt } from "../shared/db/columns.js";
import { contractVersions } from "../modules/contracts/contracts.schema.js";
import { agentStageRuns, evaluationRuns } from "../modules/evaluations/evaluations.schema.js";
import { companies } from "../modules/identity/identity.schema.js";

/**
 * Consumo de IA por llamada (ER §H). Sin prompts, sin documentos y sin
 * razonamiento del modelo: solo proveedor, modelo, tokens, coste estimado y
 * estado. `is_simulated` = proveedor FAKE (MOCK) de pruebas/demo local.
 */
export const aiUsageLogs = pgTable(
  "ai_usage_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyIdColumn(),
    evaluationRunId: uuid("evaluation_run_id"),
    stageRunId: uuid("stage_run_id"),
    contractVersionId: uuid("contract_version_id"),
    taskType: text("task_type").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 14, scale: 8 }).notNull(),
    status: text("status").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    toolCalls: integer("tool_calls").notNull().default(0),
    isSimulated: boolean("is_simulated").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "ai_usage_logs_company_fk", columns: [t.companyId], foreignColumns: [companies.id] }).onDelete("restrict"),
    foreignKey({ name: "ai_usage_logs_run_fk", columns: [t.companyId, t.evaluationRunId], foreignColumns: [evaluationRuns.companyId, evaluationRuns.id] }).onDelete("restrict"),
    foreignKey({ name: "ai_usage_logs_stage_fk", columns: [t.companyId, t.stageRunId], foreignColumns: [agentStageRuns.companyId, agentStageRuns.id] }).onDelete("restrict"),
    foreignKey({ name: "ai_usage_logs_contract_version_fk", columns: [t.companyId, t.contractVersionId], foreignColumns: [contractVersions.companyId, contractVersions.id] }).onDelete("restrict"),
    index("ai_usage_logs_company_time_idx").on(t.companyId, t.createdAt),
    check("ai_usage_logs_tokens_non_negative", sql`${t.inputTokens} >= 0 and ${t.outputTokens} >= 0 and ${t.estimatedCostUsd} >= 0 and ${t.latencyMs} >= 0`),
    check("ai_usage_logs_status_valid", sql`${t.status} in ('SUCCEEDED', 'FAILED', 'TIMEOUT', 'REJECTED')`),
  ],
);
