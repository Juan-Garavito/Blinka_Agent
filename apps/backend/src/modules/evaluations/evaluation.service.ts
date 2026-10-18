import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "../../shared/db/client.js";
import { AppError, notFound } from "../../shared/errors/app-error.js";
import type { Logger } from "../../shared/logger.js";
import { D, toMoney4 } from "../../shared/money.js";
import { recordAudit, type Actor, type Executor } from "../audit/audit.service.js";
import { budgetReservationAllocations, budgetReservations, contractHourConsumptions, monthlyBudgets } from "../budgets/budgets.schema.js";
import { contracts } from "../contracts/contracts.schema.js";
import type { BillingType } from "../contracts/contracts.schema.js";
import type { FxService } from "../fx/fx.service.js";
import { companies } from "../identity/identity.schema.js";
import { invoices, invoiceVersions } from "../invoices/invoices.schema.js";
import { evidenceRuleCode } from "../evidence/verifier.js";
import { decide, periodOf, type EngineApproval, type EngineInput, type EngineResult } from "./decision-engine.js";
import { loadEngineContext, readBudgets } from "./evaluation-context.js";
import { agentStageRuns, evaluationAppliedPolicies, evaluationChecks, evaluationEvidence, evaluationFlows, evaluationRuns, type FlowTrigger, type VisibleOutcome } from "./evaluations.schema.js";

export const DEFAULT_SUPPORTED_CURRENCIES = new Set(["USD", "EUR", "COP", "GBP", "MXN", "CAD", "BRL", "CHF", "JPY"]);

/** Ganchos para B5 (aprobaciones simuladas) sin acoplar este módulo a aquel. */
export interface ApprovalHooks {
  /** Aprobaciones APROBADAS vigentes para la factura (se revalidan en el motor). */
  approvedFor(exec: Executor, companyId: string, invoiceId: string): Promise<EngineApproval[]>;
  /** Crear la solicitud de aprobación cuando el resultado es EN_APROBACION por importe. */
  requestApproval(exec: Executor, args: { companyId: string; flowId: string; runId: string; invoiceVersionId: string; personaId: string; amountBase: string; actor: Actor }): Promise<void>;
}

export const noApprovals: ApprovalHooks = {
  approvedFor: () => Promise.resolve([]),
  requestApproval: () => Promise.resolve(),
};

export interface EvaluationSummary {
  flowId: string;
  runId: string;
  runNo: number;
  status: "COMPLETED" | "SUPERSEDED";
  decision: EngineResult["decision"];
  visibleOutcome: VisibleOutcome | null;
  reasonCode: string | null;
  amountBase: string | null;
  period: string | null;
  reservationId: string | null;
}

/** Estados comerciales que cierran un trámite (no se reescriben). */
const TERMINAL: ReadonlySet<VisibleOutcome> = new Set(["AUTORIZADA", "BLOQUEADA", "RECHAZADA"]);

export function createEvaluationService(deps: {
  db: Database;
  fx: FxService;
  logger: Logger;
  fingerprintSecret: string | undefined;
  supportedCurrencies?: ReadonlySet<string>;
  approvals?: ApprovalHooks;
  now?: () => Date;
  /** Solo pruebas: inyecta un fallo entre la actualización de los dos presupuestos (FIN-23). */
  faultInjection?: { afterGlobalBudgetUpdate?: () => void };
}) {
  const { db, fx, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const supported = deps.supportedCurrencies ?? DEFAULT_SUPPORTED_CURRENCIES;
  const approvals = deps.approvals ?? noApprovals;

  /**
   * Abre (o reutiliza) el trámite abierto de la factura y crea una corrida
   * RUNNING sobre su versión actual. Una factura ya autorizada no se reevalúa.
   */
  async function openRun(companyId: string, invoiceId: string, opts: { trigger: FlowTrigger; actor: Actor; justification?: string }) {
    return db.transaction(async (tx) => {
      const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId))).for("update");
      if (!inv) throw notFound("Factura no encontrada");
      const [reserved] = await tx.select({ id: budgetReservations.id }).from(budgetReservations).where(eq(budgetReservations.invoiceId, invoiceId));
      if (reserved) throw new AppError(409, "ALREADY_AUTHORIZED", "La factura ya está autorizada; no se reevalúa", { details: { reservationId: reserved.id } });

      let [flow] = await tx.select().from(evaluationFlows).where(and(eq(evaluationFlows.invoiceId, invoiceId), isNull(evaluationFlows.closedAt)));
      if (!flow) {
        const [last] = await tx.select({ id: evaluationFlows.id }).from(evaluationFlows).where(eq(evaluationFlows.invoiceId, invoiceId)).orderBy(desc(evaluationFlows.openedAt)).limit(1);
        [flow] = await tx
          .insert(evaluationFlows)
          .values({
            companyId,
            invoiceId,
            previousFlowId: last?.id ?? null,
            triggerType: opts.trigger,
            justification: opts.justification ?? null,
            openedByUserId: opts.actor.kind === "USER" ? opts.actor.ref : null,
          })
          .returning();
        await recordAudit(tx, { companyId, actor: opts.actor, eventType: "evaluation.flow_opened", entityType: "evaluation_flow", entityRef: flow!.id, details: { invoiceId, trigger: opts.trigger, previousFlowId: last?.id ?? null } });
      }
      const [{ next }] = (await tx
        .select({ next: sql<number>`coalesce(max(${evaluationRuns.runNo}), 0) + 1` })
        .from(evaluationRuns)
        .where(eq(evaluationRuns.flowId, flow!.id))) as [{ next: number }];
      const [run] = await tx
        .insert(evaluationRuns)
        .values({ companyId, flowId: flow!.id, invoiceVersionId: inv.currentVersionId!, runNo: Number(next), status: "RUNNING" })
        .returning();
      return { flowId: flow!.id, runId: run!.id, runNo: run!.runNo, invoiceVersionId: run!.invoiceVersionId };
    });
  }

  /** FX fuera de la transacción (sin red con bloqueos tomados). */
  async function resolveFx(companyId: string, invoiceVersionId: string): Promise<EngineInput["fx"]> {
    const [row] = await db
      .select({ currency: invoiceVersions.originalCurrency, total: invoiceVersions.totalAmount, base: companies.baseCurrency })
      .from(invoiceVersions)
      .innerJoin(companies, eq(companies.id, invoiceVersions.companyId))
      .where(and(eq(invoiceVersions.id, invoiceVersionId), eq(invoiceVersions.companyId, companyId)));
    if (!row?.currency || !row.total || !supported.has(row.currency)) return { status: "NOT_REQUESTED" };
    const res = await fx.resolve(row.currency, row.base);
    if (res.status === "UNAVAILABLE") return { status: "UNAVAILABLE", reason: res.reason };
    return { status: "OK", snapshotId: res.snapshot.id, rate: res.snapshot.rate, provider: res.snapshot.provider, isSimulated: res.snapshot.isSimulated, validUntil: res.snapshot.validUntil };
  }

  /**
   * Decisión final en UNA transacción: bloquea factura → presupuesto global →
   * presupuesto de categoría (orden fijo), recarga el contexto, decide con los
   * valores bloqueados y, si AUTHORIZE, crea una reserva + dos asignaciones.
   * Cualquier fallo revierte todo (ninguna reserva parcial).
   */
  async function finalize(
    companyId: string,
    runId: string,
    opts: {
      actor: Actor;
      fx: EngineInput["fx"];
      detectedBillingType: BillingType | "UNKNOWN" | "MIXED" | null;
      extraction?: EngineInput["extraction"];
      /** Etapa FINANCIAL_DECISION a cerrar en la MISMA transacción que la decisión (consistencia del polling). */
      stageRunId?: string;
    },
  ): Promise<EvaluationSummary> {
    const at = now();
    const summary = await db.transaction(async (tx) => {
      const [runRow] = await tx.select().from(evaluationRuns).where(and(eq(evaluationRuns.id, runId), eq(evaluationRuns.companyId, companyId)));
      if (!runRow) throw notFound("Corrida no encontrada");
      const [version] = await tx.select({ invoiceId: invoiceVersions.invoiceId }).from(invoiceVersions).where(eq(invoiceVersions.id, runRow.invoiceVersionId));
      const invoiceId = version!.invoiceId;
      // 1. Bloqueo de la factura (serializa evaluaciones concurrentes de la misma factura).
      const [inv] = await tx.select({ id: invoices.id, currentVersionId: invoices.currentVersionId }).from(invoices).where(eq(invoices.id, invoiceId)).for("update");
      const [run] = await tx.select().from(evaluationRuns).where(eq(evaluationRuns.id, runId)).for("update");
      if (run!.status !== "RUNNING") return toSummary(run!, null);

      // Idempotencia: si otra corrida ya autorizó esta factura, esta no crea nada.
      const [existing] = await tx.select().from(budgetReservations).where(eq(budgetReservations.invoiceId, invoiceId));
      if (existing) {
        const [sup] = await tx.update(evaluationRuns).set({ status: "SUPERSEDED", reasonCode: "ALREADY_AUTHORIZED", evaluatedAt: at }).where(eq(evaluationRuns.id, runId)).returning();
        return toSummary(sup!, existing.id);
      }
      // Una versión más nueva de la factura invalida esta corrida (insumo cambiado).
      if (inv!.currentVersionId !== run!.invoiceVersionId) {
        const [sup] = await tx.update(evaluationRuns).set({ status: "SUPERSEDED", reasonCode: "INVOICE_VERSION_CHANGED", evaluatedAt: at }).where(eq(evaluationRuns.id, runId)).returning();
        return toSummary(sup!, null);
      }

      const [company] = await tx.select({ timezone: companies.timezone }).from(companies).where(eq(companies.id, companyId));
      const period = periodOf(at, company!.timezone);
      const approved = await approvals.approvedFor(tx, companyId, invoiceId);
      const ctxArgs = {
        companyId,
        invoiceVersionId: run!.invoiceVersionId,
        now: at,
        fx: opts.fx,
        detectedBillingType: opts.detectedBillingType,
        fingerprintSecret: deps.fingerprintSecret,
        supportedCurrencies: supported,
        approvals: approved,
        period,
        extraction: opts.extraction ?? null,
      };
      // 2. Bloqueo de los contratos del proveedor (orden por id): serializa el tope ACUMULADO de horas
      //    entre facturas concurrentes del mismo contrato. Orden global: factura → contratos → presupuestos.
      const [invVendor] = await tx.select({ vendorId: invoices.vendorId }).from(invoices).where(eq(invoices.id, invoiceId));
      await tx.select({ id: contracts.id }).from(contracts).where(and(eq(contracts.companyId, companyId), eq(contracts.vendorId, invVendor!.vendorId))).orderBy(asc(contracts.id)).for("update");
      // 3. Pre-decisión para conocer la categoría efectiva; 4. bloqueo de presupuestos en orden fijo; 5. decisión final.
      const pre = decide(await loadEngineContext(tx, ctxArgs));
      const locked = pre.effectiveCategoryId ? await readBudgets(tx, companyId, period, true, pre.effectiveCategoryId) : await readBudgets(tx, companyId, period, true, null);
      const result = decide(await loadEngineContext(tx, { ...ctxArgs, lockedBudgets: locked }));

      await persistResult(tx, companyId, run!.id, result, (await tx.select({ d: invoiceVersions.sourceDocumentId }).from(invoiceVersions).where(eq(invoiceVersions.id, run!.invoiceVersionId)))[0]!.d);
      let reservationId: string | null = null;
      if (result.decision === "AUTHORIZE" && result.budgetsToReserve && result.amountBase) {
        reservationId = await reserve(tx, { companyId, invoiceId, runId: run!.id, result, at });
      }
      const [done] = await tx
        .update(evaluationRuns)
        .set({
          status: "COMPLETED",
          detectedBillingType: opts.detectedBillingType ?? result.selectedContract?.billingType ?? null,
          selectedContractVersionId: result.selectedContract?.versionId ?? null,
          matchedBankAccountId: result.matchedBankAccountId,
          fxRateSnapshotId: result.fxSnapshotId,
          amountBase: result.amountBase,
          baseCurrency: result.amountBase ? (await tx.select({ c: companies.baseCurrency }).from(companies).where(eq(companies.id, companyId)))[0]!.c : null,
          decision: result.decision,
          visibleOutcome: result.visibleOutcome,
          reasonCode: result.reasonCode,
          engineVersion: result.engineVersion,
          evaluatedAt: at,
        })
        .where(eq(evaluationRuns.id, run!.id))
        .returning();
      if (TERMINAL.has(result.visibleOutcome)) {
        await tx.update(evaluationFlows).set({ terminalStatus: result.visibleOutcome, closedAt: at }).where(eq(evaluationFlows.id, run!.flowId));
      }
      if (opts.stageRunId) {
        await tx
          .update(agentStageRuns)
          .set({ status: "SUCCEEDED", resultRef: JSON.stringify({ visibleOutcome: result.visibleOutcome, reasonCode: result.reasonCode, status: "COMPLETED" }), finishedAt: at })
          .where(and(eq(agentStageRuns.id, opts.stageRunId), eq(agentStageRuns.status, "RUNNING")));
      }
      if (result.approvalRequired) {
        await approvals.requestApproval(tx, { companyId, flowId: run!.flowId, runId: run!.id, invoiceVersionId: run!.invoiceVersionId, personaId: result.approvalRequired.personaId, amountBase: result.approvalRequired.amountBase, actor: opts.actor });
      }
      await recordAudit(tx, {
        companyId,
        actor: opts.actor,
        eventType: "evaluation.completed",
        entityType: "invoice",
        entityRef: invoiceId,
        details: { runId: run!.id, decision: result.decision, visibleOutcome: result.visibleOutcome, reasonCode: result.reasonCode, amountBase: result.amountBase, period, reservationId },
      });
      return { ...toSummary(done!, reservationId), period };
    });
    logger.info({ runId, companyId, outcome: summary.visibleOutcome, reason: summary.reasonCode }, "Evaluación finalizada");
    return summary;
  }

  async function persistResult(tx: Executor, companyId: string, runId: string, result: EngineResult, documentId: string) {
    let inserted: Array<{ id: string; ruleCode: string }> = [];
    if (result.checks.length > 0) {
      inserted = await tx.insert(evaluationChecks).values(
        result.checks.map((c, i) => ({
          companyId,
          evaluationRunId: runId,
          seq: i + 1,
          ruleCode: c.ruleCode,
          outcome: c.outcome,
          effect: c.effect,
          observedText: c.observedText ?? null,
          expectedText: c.expectedText ?? null,
          observedAmount: c.observedAmount ?? null,
          expectedAmount: c.expectedAmount ?? null,
          currency: c.currency ?? null,
          reason: c.reason,
        })),
      ).returning({ id: evaluationChecks.id, ruleCode: evaluationChecks.ruleCode });
    }
    if (result.fieldEvidence.length > 0) {
      // Procedencia verificable de cada valor: página, posición y fragmento REAL del documento.
      await tx.insert(evaluationEvidence).values(
        result.fieldEvidence.map((e) => ({
          companyId,
          evaluationRunId: runId,
          evaluationCheckId: inserted.find((c) => c.ruleCode === evidenceRuleCode(e.field))?.id ?? null,
          documentId,
          sourceField: e.field,
          pageNumber: e.page,
          charStart: e.start,
          charEnd: e.end,
          excerpt: e.excerpt?.slice(0, 500) ?? null,
          verificationStatus: e.status,
        })),
      );
    }
    if (result.appliedPolicies.length > 0) {
      await tx.insert(evaluationAppliedPolicies).values(result.appliedPolicies.map((p) => ({ companyId, evaluationRunId: runId, policyVersionId: p.policyVersionId, applicabilityReason: p.reason })));
    }
  }

  /** Una reserva + exactamente dos asignaciones del MISMO importe (no son dos gastos). */
  async function reserve(tx: Executor, args: { companyId: string; invoiceId: string; runId: string; result: EngineResult; at: Date }) {
    const { result } = args;
    const amount = result.amountBase!;
    const { global, category } = result.budgetsToReserve!;
    const [{ base }] = (await tx.select({ base: companies.baseCurrency }).from(companies).where(eq(companies.id, args.companyId))) as [{ base: string }];
    const [ver] = await tx
      .select({ total: invoiceVersions.totalAmount, currency: invoiceVersions.originalCurrency })
      .from(invoiceVersions)
      .innerJoin(evaluationRuns, eq(evaluationRuns.invoiceVersionId, invoiceVersions.id))
      .where(eq(evaluationRuns.id, args.runId));
    const [reservation] = await tx
      .insert(budgetReservations)
      .values({
        companyId: args.companyId,
        invoiceId: args.invoiceId,
        authorizingRunId: args.runId,
        fxRateSnapshotId: result.fxSnapshotId,
        originalAmount: ver!.total!,
        originalCurrency: ver!.currency!,
        reservedAmountBase: amount,
        baseCurrency: base,
        periodYyyyMm: result.period,
        // Una autorización por factura: la clave impide duplicar aunque el trabajo se reentregue.
        idempotencyKey: `authorize:${args.invoiceId}`,
        authorizedAt: args.at,
      })
      .returning({ id: budgetReservations.id });
    await tx.insert(budgetReservationAllocations).values([
      { companyId: args.companyId, reservationId: reservation!.id, monthlyBudgetId: global.id, scope: "GLOBAL", amountBase: amount },
      { companyId: args.companyId, reservationId: reservation!.id, monthlyBudgetId: category.id, scope: "CATEGORY", amountBase: amount },
    ]);
    // Incremento atómico; el CHECK reserved_base <= limit_base es la última barrera contra sobregiros.
    await tx.update(monthlyBudgets).set({ reservedBase: sql`${monthlyBudgets.reservedBase} + ${amount}::numeric` }).where(eq(monthlyBudgets.id, global.id));
    deps.faultInjection?.afterGlobalBudgetUpdate?.();
    await tx.update(monthlyBudgets).set({ reservedBase: sql`${monthlyBudgets.reservedBase} + ${amount}::numeric` }).where(eq(monthlyBudgets.id, category.id));
    if (result.hoursToConsume) {
      // Consumo contractual de horas en la MISMA transacción que la reserva (UNIQUE por factura).
      await tx.insert(contractHourConsumptions).values({
        companyId: args.companyId,
        contractId: result.hoursToConsume.contractId,
        periodKey: result.hoursToConsume.periodKey,
        invoiceId: args.invoiceId,
        reservationId: reservation!.id,
        hours: result.hoursToConsume.hours,
      });
    }
    await recordAudit(tx, {
      companyId: args.companyId,
      actor: { kind: "SYSTEM", ref: "decision-engine" },
      eventType: "invoice.authorized",
      entityType: "invoice",
      entityRef: args.invoiceId,
      details: { reservationId: reservation!.id, amountBase: amount, baseCurrency: base, period: result.period, globalBudgetId: global.id, categoryBudgetId: category.id, hoursConsumed: result.hoursToConsume, simulated: true },
    });
    return reservation!.id;
  }

  function toSummary(run: typeof evaluationRuns.$inferSelect, reservationId: string | null): EvaluationSummary {
    return {
      flowId: run.flowId,
      runId: run.id,
      runNo: run.runNo,
      status: run.status === "SUPERSEDED" ? "SUPERSEDED" : "COMPLETED",
      decision: run.decision,
      visibleOutcome: run.visibleOutcome,
      reasonCode: run.reasonCode,
      amountBase: run.amountBase,
      period: null,
      reservationId,
    };
  }

  /**
   * Cierra la corrida como ERROR técnico (reintentos agotados o fallo
   * permanente del proveedor). Sin decisión, sin reserva; el trámite queda
   * abierto para un reintento manual seguro.
   */
  async function finalizeTechnicalError(companyId: string, runId: string, args: { actor: Actor; errorCode: string; reason: string }) {
    return db.transaction(async (tx) => {
      const [run] = await tx.select().from(evaluationRuns).where(and(eq(evaluationRuns.id, runId), eq(evaluationRuns.companyId, companyId))).for("update");
      if (!run) throw notFound("Corrida no encontrada");
      if (run.status !== "RUNNING") return toSummary(run, null);
      const at = now();
      await tx.insert(evaluationChecks).values({ companyId, evaluationRunId: runId, seq: 1, ruleCode: "TECHNICAL_FAILURE", outcome: "FAIL", effect: "ERROR", observedText: args.errorCode, reason: args.reason });
      const [done] = await tx
        .update(evaluationRuns)
        .set({ status: "COMPLETED", decision: null, visibleOutcome: "ERROR", reasonCode: args.errorCode, engineVersion: "pipeline", evaluatedAt: at })
        .where(eq(evaluationRuns.id, runId))
        .returning();
      const [ver] = await tx.select({ invoiceId: invoiceVersions.invoiceId }).from(invoiceVersions).where(eq(invoiceVersions.id, run.invoiceVersionId));
      await recordAudit(tx, { companyId, actor: args.actor, eventType: "evaluation.technical_error", entityType: "invoice", entityRef: ver!.invoiceId, details: { runId, errorCode: args.errorCode } });
      return toSummary(done!, null);
    });
  }

  return {
    openRun,
    resolveFx,
    finalize,
    finalizeTechnicalError,

    /** Evaluación determinista completa (sin IA): datos registrados de la versión actual. */
    async evaluate(companyId: string, invoiceId: string, opts: { trigger: FlowTrigger; actor: Actor; justification?: string; detectedBillingType?: BillingType | "UNKNOWN" | "MIXED" | null }) {
      const { runId, invoiceVersionId } = await openRun(companyId, invoiceId, opts);
      const fxRes = await resolveFx(companyId, invoiceVersionId);
      return finalize(companyId, runId, { actor: opts.actor, fx: fxRes, detectedBillingType: opts.detectedBillingType ?? null });
    },

    /** Historial auditable: trámites, corridas, comprobaciones, políticas aplicadas y reserva. */
    async history(companyId: string, invoiceId: string) {
      const [inv] = await db.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));
      if (!inv) throw notFound("Factura no encontrada");
      const flows = await db.select().from(evaluationFlows).where(and(eq(evaluationFlows.invoiceId, invoiceId), eq(evaluationFlows.companyId, companyId))).orderBy(asc(evaluationFlows.openedAt));
      const runs = flows.length
        ? await db.select().from(evaluationRuns).where(and(eq(evaluationRuns.companyId, companyId), inArray(evaluationRuns.flowId, flows.map((f) => f.id)))).orderBy(asc(evaluationRuns.runNo))
        : [];
      const checks = runs.length
        ? await db.select().from(evaluationChecks).where(and(eq(evaluationChecks.companyId, companyId), inArray(evaluationChecks.evaluationRunId, runs.map((r) => r.id)))).orderBy(asc(evaluationChecks.seq))
        : [];
      const applied = runs.length
        ? await db.select().from(evaluationAppliedPolicies).where(and(eq(evaluationAppliedPolicies.companyId, companyId), inArray(evaluationAppliedPolicies.evaluationRunId, runs.map((r) => r.id))))
        : [];
      const [reservation] = await db.select().from(budgetReservations).where(and(eq(budgetReservations.invoiceId, invoiceId), eq(budgetReservations.companyId, companyId)));
      const allocations = reservation ? await db.select().from(budgetReservationAllocations).where(eq(budgetReservationAllocations.reservationId, reservation.id)) : [];
      const latest = [...runs].filter((r) => r.status === "COMPLETED").sort((a, b) => (a.evaluatedAt! < b.evaluatedAt! ? 1 : -1))[0];
      return {
        status: latest?.visibleOutcome ?? null,
        flows: flows.map((f) => ({
          ...f,
          runs: runs
            .filter((r) => r.flowId === f.id)
            .map((r) => ({ ...r, checks: checks.filter((c) => c.evaluationRunId === r.id), appliedPolicies: applied.filter((p) => p.evaluationRunId === r.id) })),
        })),
        reservation: reservation ? { ...reservation, allocations, simulated: true } : null,
      };
    },
  };
}

export type EvaluationService = ReturnType<typeof createEvaluationService>;

/** Utilidad de lectura de importes disponibles (para el dashboard). */
export const availableOf = (b: { limitBase: string; reservedBase: string }) => toMoney4(new D(b.limitBase).minus(b.reservedBase));
