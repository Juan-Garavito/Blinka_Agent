import { and, eq, isNull } from "drizzle-orm";
import { recordAudit } from "../audit/audit.service.js";
import type { ApprovalHooks } from "../evaluations/evaluation.service.js";
import { evaluationFlows } from "../evaluations/evaluations.schema.js";
import { approvalRequests } from "./approvals.schema.js";

/**
 * Integración de aprobaciones simuladas con el motor:
 * - approvedFor: solo aprobaciones APPROVED del trámite ABIERTO de la factura;
 *   el motor las vuelve a validar (misma versión, misma persona, importe ≤ aprobado).
 * - requestApproval: idempotente; una solicitud pendiente con otros términos se
 *   marca SUPERSEDED y se crea la nueva (una pendiente por trámite).
 */
export const approvalHooks: ApprovalHooks = {
  async approvedFor(exec, companyId, invoiceId) {
    const rows = await exec
      .select({ id: approvalRequests.id, invoiceVersionId: approvalRequests.invoiceVersionId, amountBase: approvalRequests.amountBase, personaId: approvalRequests.personaId })
      .from(approvalRequests)
      .innerJoin(evaluationFlows, eq(evaluationFlows.id, approvalRequests.flowId))
      .where(and(eq(approvalRequests.companyId, companyId), eq(evaluationFlows.invoiceId, invoiceId), isNull(evaluationFlows.closedAt), eq(approvalRequests.status, "APPROVED")));
    return rows.map((r) => ({ approvalRequestId: r.id, invoiceVersionId: r.invoiceVersionId, amountBase: r.amountBase, personaId: r.personaId }));
  },

  async requestApproval(exec, args) {
    const [pending] = await exec
      .select()
      .from(approvalRequests)
      .where(and(eq(approvalRequests.flowId, args.flowId), eq(approvalRequests.status, "PENDING")))
      .for("update");
    if (pending && pending.invoiceVersionId === args.invoiceVersionId && pending.personaId === args.personaId && pending.amountBase === args.amountBase) return;
    if (pending) {
      await exec.update(approvalRequests).set({ status: "SUPERSEDED", resolvedAt: new Date() }).where(eq(approvalRequests.id, pending.id));
    }
    const [row] = await exec
      .insert(approvalRequests)
      .values({ companyId: args.companyId, flowId: args.flowId, requestedByRunId: args.runId, invoiceVersionId: args.invoiceVersionId, personaId: args.personaId, amountBase: args.amountBase })
      .returning({ id: approvalRequests.id });
    await recordAudit(exec, {
      companyId: args.companyId,
      actor: args.actor,
      eventType: "approval.requested",
      entityType: "approval_request",
      entityRef: row!.id,
      details: { flowId: args.flowId, runId: args.runId, personaId: args.personaId, amountBase: args.amountBase, supersedes: pending?.id ?? null, simulated: true },
    });
  },
};
