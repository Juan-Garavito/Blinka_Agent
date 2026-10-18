import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../shared/db/client.js";
import { AppError, notFound } from "../../shared/errors/app-error.js";
import type { CompanyCtx } from "../../shared/http/context.js";
import { recordAudit } from "../audit/audit.service.js";
import { approvalPersonas } from "../company-config/company-config.schema.js";
import type { EvaluationService } from "../evaluations/evaluation.service.js";
import { evaluationChecks, evaluationFlows, evaluationRuns } from "../evaluations/evaluations.schema.js";
import { invoices, invoiceVersions } from "../invoices/invoices.schema.js";
import { vendors } from "../vendors/vendors.schema.js";
import { APPROVAL_STATUSES, approvalRequests } from "./approvals.schema.js";

export const resolveBody = z.object({ decision: z.enum(["APPROVE", "REJECT"]), reason: z.string().trim().min(3).max(500) }).strict();
export const listQuery = z.object({ status: z.enum(APPROVAL_STATUSES).optional() });

export function createApprovalsService(deps: { db: Database; evaluations: EvaluationService }) {
  const { db } = deps;

  return {
    list: (ctx: CompanyCtx, status?: (typeof APPROVAL_STATUSES)[number]) =>
      db
        .select({
          id: approvalRequests.id,
          status: approvalRequests.status,
          amountBase: approvalRequests.amountBase,
          requestedAt: approvalRequests.requestedAt,
          resolvedAt: approvalRequests.resolvedAt,
          resolutionReason: approvalRequests.resolutionReason,
          flowId: approvalRequests.flowId,
          invoiceId: evaluationFlows.invoiceId,
          vendorName: vendors.legalName,
          supplierInvoiceNumber: invoiceVersions.supplierInvoiceNumber,
          invoiceVersionId: approvalRequests.invoiceVersionId,
          persona: { id: approvalPersonas.id, displayName: approvalPersonas.displayName, designation: approvalPersonas.designation },
        })
        .from(approvalRequests)
        .innerJoin(evaluationFlows, eq(evaluationFlows.id, approvalRequests.flowId))
        .innerJoin(invoices, and(eq(invoices.id, evaluationFlows.invoiceId), eq(invoices.companyId, approvalRequests.companyId)))
        .innerJoin(vendors, and(eq(vendors.id, invoices.vendorId), eq(vendors.companyId, approvalRequests.companyId)))
        .innerJoin(invoiceVersions, and(eq(invoiceVersions.id, approvalRequests.invoiceVersionId), eq(invoiceVersions.companyId, approvalRequests.companyId)))
        .innerJoin(approvalPersonas, eq(approvalPersonas.id, approvalRequests.personaId))
        .where(and(eq(approvalRequests.companyId, ctx.companyId), status ? eq(approvalRequests.status, status) : undefined))
        .orderBy(desc(approvalRequests.requestedAt)),

    /**
     * Resolución SIMULADA registrada por el evaluador autenticado en nombre de la
     * persona ficticia. APPROVE no autoriza: dispara una nueva evaluación que
     * revalida todo bajo bloqueo. REJECT cierra el trámite como RECHAZADA.
     */
    async resolve(ctx: CompanyCtx, requestId: string, body: z.infer<typeof resolveBody>) {
      if (ctx.actor.kind !== "USER") throw new AppError(403, "HUMAN_REQUIRED", "Solo una persona autenticada registra la resolución simulada");
      const outcome = await db.transaction(async (tx) => {
        const [req] = await tx
          .select()
          .from(approvalRequests)
          .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.companyId, ctx.companyId)))
          .for("update");
        if (!req) throw notFound("Solicitud de aprobación no encontrada");
        // Doble clic / resolución concurrente: la segunda encuentra la fila ya resuelta.
        if (req.status !== "PENDING") throw new AppError(409, "APPROVAL_ALREADY_RESOLVED", "La solicitud ya fue resuelta o sustituida", { details: { status: req.status } });
        const [flow] = await tx.select().from(evaluationFlows).where(eq(evaluationFlows.id, req.flowId)).for("update");
        if (flow!.closedAt) throw new AppError(409, "FLOW_CLOSED", "El trámite ya está cerrado");
        const [persona] = await tx.select({ active: approvalPersonas.active, name: approvalPersonas.displayName }).from(approvalPersonas).where(eq(approvalPersonas.id, req.personaId));
        if (!persona?.active) throw new AppError(409, "PERSONA_INACTIVE", "La persona aprobadora simulada está inactiva");

        const at = new Date();
        const status = body.decision === "APPROVE" ? "APPROVED" : "REJECTED";
        await tx.update(approvalRequests).set({ status, resolvedAt: at, resolvedByUserId: ctx.actor.ref, resolutionReason: body.reason }).where(eq(approvalRequests.id, req.id));
        await recordAudit(tx, {
          companyId: ctx.companyId,
          actor: ctx.actor,
          eventType: status === "APPROVED" ? "approval.approved" : "approval.rejected",
          entityType: "approval_request",
          entityRef: req.id,
          details: { simulated: true, simulatedApproverPersonaId: req.personaId, simulatedApproverName: persona.name, evaluatorUserId: ctx.actor.ref, reason: body.reason, invoiceVersionId: req.invoiceVersionId, amountBase: req.amountBase },
        });

        if (status === "REJECTED") {
          // Resolución humana negativa: RECHAZADA (≠ BLOQUEADA), sin reserva, trámite cerrado.
          const [inv] = await tx.select({ current: invoices.currentVersionId }).from(invoices).where(eq(invoices.id, flow!.invoiceId));
          const [{ next }] = (await tx.select({ next: sql<number>`coalesce(max(${evaluationRuns.runNo}), 0) + 1` }).from(evaluationRuns).where(eq(evaluationRuns.flowId, flow!.id))) as [{ next: number }];
          const [run] = await tx.insert(evaluationRuns).values({ companyId: ctx.companyId, flowId: flow!.id, invoiceVersionId: inv!.current!, runNo: Number(next), status: "RUNNING" }).returning();
          await tx.insert(evaluationChecks).values({ companyId: ctx.companyId, evaluationRunId: run!.id, seq: 1, ruleCode: "HUMAN_REJECTION", outcome: "FAIL", effect: "INFO", observedText: req.id, reason: `Rechazada por persona aprobadora simulada: ${body.reason}` });
          await tx.update(evaluationRuns).set({ status: "COMPLETED", decision: null, visibleOutcome: "RECHAZADA", reasonCode: "APPROVAL_REJECTED", engineVersion: "human-resolution", evaluatedAt: at }).where(eq(evaluationRuns.id, run!.id));
          await tx.update(evaluationFlows).set({ terminalStatus: "RECHAZADA", closedAt: at }).where(eq(evaluationFlows.id, flow!.id));
          await recordAudit(tx, { companyId: ctx.companyId, actor: ctx.actor, eventType: "invoice.rejected", entityType: "invoice", entityRef: flow!.invoiceId, details: { approvalRequestId: req.id, runId: run!.id, simulated: true } });
          return { status, invoiceId: flow!.invoiceId, runId: run!.id };
        }
        return { status, invoiceId: flow!.invoiceId, runId: null };
      });

      if (outcome.status === "REJECTED") return { approval: { id: requestId, status: outcome.status }, evaluation: { runId: outcome.runId, visibleOutcome: "RECHAZADA" as const }, simulated: true };
      // APPROVED: nueva evaluación determinista (revalida FX, contrato, cuenta, políticas y presupuestos).
      const evaluation = await deps.evaluations.evaluate(ctx.companyId, outcome.invoiceId, { trigger: "APPROVAL_RESOLVED", actor: ctx.actor, justification: body.reason });
      return { approval: { id: requestId, status: outcome.status }, evaluation, simulated: true };
    },

    async forInvoice(ctx: CompanyCtx, invoiceId: string) {
      const [inv] = await db.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, ctx.companyId)));
      if (!inv) throw notFound("Factura no encontrada");
      return db
        .select({ request: approvalRequests, versionNo: invoiceVersions.versionNo })
        .from(approvalRequests)
        .innerJoin(evaluationFlows, eq(evaluationFlows.id, approvalRequests.flowId))
        .innerJoin(invoiceVersions, eq(invoiceVersions.id, approvalRequests.invoiceVersionId))
        .where(and(eq(approvalRequests.companyId, ctx.companyId), eq(evaluationFlows.invoiceId, invoiceId)))
        .orderBy(desc(approvalRequests.requestedAt));
    },
  };
}

export type ApprovalsService = ReturnType<typeof createApprovalsService>;
