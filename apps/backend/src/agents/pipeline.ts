import { createHash } from "node:crypto";
import { estimateAiCostUsd } from "./ai-cost.js";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../shared/db/client.js";
import type { Logger } from "../shared/logger.js";
import type { Actor } from "../modules/audit/audit.service.js";
import { documents } from "../modules/documents/documents.schema.js";
import { documentTextPages } from "../modules/evidence/evidence.schema.js";
import type { DocumentStorage } from "../modules/documents/storage.js";
import { explainCandidates, decide, periodOf, type EngineInput } from "../modules/evaluations/decision-engine.js";
import { loadEngineContext } from "../modules/evaluations/evaluation-context.js";
import type { EvaluationService } from "../modules/evaluations/evaluation.service.js";
import { agentStageRuns, evaluationContractCandidates, evaluationEvidence, evaluationRuns, type StageCode } from "../modules/evaluations/evaluations.schema.js";
import { companies } from "../modules/identity/identity.schema.js";
import { invoices, invoiceVersions } from "../modules/invoices/invoices.schema.js";
import type { InvoicesService } from "../modules/invoices/invoices.service.js";
import { aiUsageLogs } from "./ai-usage.schema.js";
import { AIProviderError, type AIProvider } from "./ai/types.js";
import { HarnessError, runSpecialist, type Semaphore, type SpecialistLimits, type UsageRecord } from "./harness.js";
import { EXTRACTOR_PROMPT_VERSION, extractorSpecialist, type ExtractionOutput } from "./specialists/extractor.js";

/** Fallo temporal de una etapa: la cola reintentará solo lo pendiente (las etapas válidas se reutilizan). */
export class RetryableStageError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RetryableStageError";
  }
}

const sha = (...parts: string[]) => createHash("sha256").update(parts.join("\u0000")).digest("hex");
const AGENT: Actor = { kind: "AGENT", ref: "invoice-extractor" };
const SYSTEM: Actor = { kind: "SYSTEM", ref: "analysis-pipeline" };

interface ExtractionResult {
  status: "OK" | "INSUFFICIENT";
  reason: string;
  versionId: string | null;
  billingType: ExtractionOutput["billingType"] | null;
}

export interface PipelineDeps {
  db: Database;
  storage: DocumentStorage;
  provider: AIProvider;
  semaphore: Semaphore;
  invoices: InvoicesService;
  evaluations: EvaluationService;
  logger: Logger;
  limits: SpecialistLimits;
  pricing: { inputUsdPerMTok: string; outputUsdPerMTok: string };
  fingerprintSecret: string | undefined;
  supportedCurrencies: ReadonlySet<string>;
  /** Intento actual del trabajo y máximo: decide si un fallo FX se reintenta o termina en ERROR. */
  attempt?: { current: number; max: number };
  now?: () => Date;
}

/**
 * Pipeline de análisis (B4) sobre LangGraph.js, dentro del proceso worker:
 * EXTRACT_CLASSIFY → CONTRACT_MATCH → CONTRACT_VALIDATE → FINANCIAL_DECISION.
 * Cada etapa queda registrada en agent_stage_runs con su huella de entradas.
 * La IA solo extrae y clasifica; el último nodo llama al DecisionEngine en código.
 */
export function createAnalysisPipeline(deps: PipelineDeps) {
  const { db, logger } = deps;
  const now = deps.now ?? (() => new Date());

  /**
   * Ejecuta o reutiliza una etapa. `reuse`:
   * - "company": cualquier intento SUCCEEDED con la misma huella en la empresa (extracción IA).
   * - "run": solo dentro de la misma corrida (etapas deterministas ya registradas).
   * - "never": siempre se ejecuta (decisión financiera).
   */
  async function stage(
    companyId: string,
    runId: string,
    code: StageCode,
    fingerprint: string,
    reuse: "company" | "run" | "never",
    fn: (stageRunId: string) => Promise<string | null>,
  ): Promise<{ resultRef: string | null; reused: boolean }> {
    const [{ attempts }] = (await db
      .select({ attempts: sql<number>`count(*)::int` })
      .from(agentStageRuns)
      .where(and(eq(agentStageRuns.evaluationRunId, runId), eq(agentStageRuns.stageCode, code)))) as [{ attempts: number }];
    const attemptNo = attempts + 1;

    if (reuse !== "never") {
      const [prev] = await db
        .select()
        .from(agentStageRuns)
        .where(
          and(
            eq(agentStageRuns.companyId, companyId),
            eq(agentStageRuns.stageCode, code),
            eq(agentStageRuns.inputFingerprint, fingerprint),
            eq(agentStageRuns.status, "SUCCEEDED"),
            reuse === "run" ? eq(agentStageRuns.evaluationRunId, runId) : undefined,
          ),
        )
        .orderBy(desc(agentStageRuns.finishedAt))
        .limit(1);
      if (prev) {
        const at = now();
        await db.insert(agentStageRuns).values({
          companyId,
          evaluationRunId: runId,
          stageCode: code,
          attemptNo,
          status: "REUSED",
          inputFingerprint: fingerprint,
          reusedFromStageRunId: prev.id,
          resultRef: prev.resultRef,
          startedAt: at,
          finishedAt: at,
        });
        return { resultRef: prev.resultRef, reused: true };
      }
    }

    const [row] = await db
      .insert(agentStageRuns)
      .values({ companyId, evaluationRunId: runId, stageCode: code, attemptNo, status: "RUNNING", inputFingerprint: fingerprint, startedAt: now() })
      .returning({ id: agentStageRuns.id });
    try {
      const resultRef = await fn(row!.id);
      // Condicional: la etapa de decisión ya pudo cerrarse dentro de la transacción financiera.
      await db
        .update(agentStageRuns)
        .set({ status: "SUCCEEDED", resultRef, finishedAt: now() })
        .where(and(eq(agentStageRuns.id, row!.id), eq(agentStageRuns.status, "RUNNING")));
      return { resultRef, reused: false };
    } catch (err) {
      const retryable = err instanceof AIProviderError ? err.retryable : err instanceof RetryableStageError ? true : !(err instanceof HarnessError);
      const errorCode = err instanceof AIProviderError || err instanceof HarnessError || err instanceof RetryableStageError ? err.code : "UNEXPECTED";
      await db
        .update(agentStageRuns)
        .set({ status: "FAILED", errorCode, errorRetryable: retryable, finishedAt: now() })
        .where(and(eq(agentStageRuns.id, row!.id), eq(agentStageRuns.status, "RUNNING")));
      throw err;
    }
  }

  async function loadRun(companyId: string, runId: string) {
    const [row] = await db
      .select({ run: evaluationRuns, invoiceId: invoiceVersions.invoiceId, documentId: invoiceVersions.sourceDocumentId })
      .from(evaluationRuns)
      .innerJoin(invoiceVersions, eq(invoiceVersions.id, evaluationRuns.invoiceVersionId))
      .where(and(eq(evaluationRuns.id, runId), eq(evaluationRuns.companyId, companyId)));
    if (!row) throw new Error("Corrida inexistente para la empresa");
    return row;
  }

  async function logUsage(companyId: string, runId: string, stageRunId: string, u: UsageRecord) {
    await db.insert(aiUsageLogs).values({
      companyId,
      evaluationRunId: runId,
      stageRunId,
      taskType: "INVOICE_EXTRACTION",
      provider: u.provider,
      model: u.model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      estimatedCostUsd: u.isSimulated ? "0" : estimateAiCostUsd(u, deps.pricing),
      status: u.status,
      latencyMs: u.latencyMs,
      toolCalls: u.toolCalls,
      isSimulated: u.isSimulated,
    });
  }

  // ─────────────────────────── Nodos ───────────────────────────

  async function extract(companyId: string, runId: string): Promise<ExtractionResult> {
    const r = await loadRun(companyId, runId);
    const [doc] = await db.select().from(documents).where(and(eq(documents.id, r.documentId), eq(documents.companyId, companyId)));
    const fp = sha("EXTRACT_CLASSIFY", doc!.id, doc!.sha256, EXTRACTOR_PROMPT_VERSION, deps.provider.name, deps.provider.model);
    const { resultRef } = await stage(companyId, runId, "EXTRACT_CLASSIFY", fp, "company", async (stageRunId) => {
      const [inv] = await db.select({ vendorId: invoices.vendorId }).from(invoices).where(eq(invoices.id, r.invoiceId));
      const data = await deps.storage.get(doc!.storageKey);
      let output: ExtractionOutput;
      try {
        ({ output } = await runSpecialist(extractorSpecialist(db, deps.limits), {
          provider: deps.provider,
          ctx: { companyId, invoiceId: r.invoiceId, invoiceVersionId: r.run.invoiceVersionId, vendorId: inv!.vendorId, evaluationRunId: runId, stageRunId },
          document: { mimeType: doc!.mimeType, data },
          contextNote: `Factura del proveedor seleccionado por el usuario (id ${inv!.vendorId}). Usa get_vendor_profile si necesitas su identificación.`,
          semaphore: deps.semaphore,
          onUsage: (u) => logUsage(companyId, runId, stageRunId, u),
        }));
      } catch (err) {
        // Documento rechazado por el proveedor (p. ej. corrupto): defecto documental → corrección, sin bucle de reintentos.
        if (err instanceof AIProviderError && err.code === "INVALID_DOCUMENT") {
          return JSON.stringify({ status: "INSUFFICIENT", reason: "documento ilegible o corrupto", versionId: null, billingType: null } satisfies ExtractionResult);
        }
        throw err;
      }
      if (output.documentKind !== "INVOICE") {
        return JSON.stringify({ status: "INSUFFICIENT", reason: output.documentKind === "NOT_INVOICE" ? "el documento no es una factura" : "documento ilegible", versionId: null, billingType: null } satisfies ExtractionResult);
      }
      const detail = await deps.invoices.addVersion(
        { companyId, actor: AGENT },
        r.invoiceId,
        {
          reason: "Extracción asistida por IA (datos no verificados hasta la decisión)",
          data: {
            ...(output.supplierInvoiceNumber ? { supplierInvoiceNumber: output.supplierInvoiceNumber } : {}),
            ...(output.issuerTaxReference ? { issuerTaxReference: output.issuerTaxReference } : {}),
            ...(output.issueDate ? { issueDate: output.issueDate } : {}),
            ...(output.dueDate ? { dueDate: output.dueDate } : {}),
            ...(output.servicePeriodStart ? { servicePeriodStart: output.servicePeriodStart } : {}),
            ...(output.servicePeriodEnd ? { servicePeriodEnd: output.servicePeriodEnd } : {}),
            ...(output.currency ? { currency: output.currency } : {}),
            ...(output.subtotal ? { subtotal: output.subtotal } : {}),
            ...(output.taxes ? { taxes: output.taxes } : {}),
            ...(output.discounts ? { discounts: output.discounts } : {}),
            ...(output.totalAmount ? { totalAmount: output.totalAmount } : {}),
            ...(output.contractRefCited ? { contractRefCited: output.contractRefCited } : {}),
            ...(output.paymentDestinationRaw ? { paymentDestinationRaw: output.paymentDestinationRaw } : {}),
            lines: output.lines.map((l) => ({
              concept: l.concept,
              subtotal: l.subtotal,
              ...(l.itemRef ? { itemRef: l.itemRef } : {}),
              ...(l.quantity ? { quantity: l.quantity } : {}),
              ...(l.unit ? { unit: l.unit } : {}),
              ...(l.unitPrice ? { unitPrice: l.unitPrice } : {}),
              ...(l.taxAmount ? { taxAmount: l.taxAmount } : {}),
            })),
          },
        },
        "EXTRACTION",
      );
      const versionId = detail.invoice.currentVersionId!;
      if (output.evidence.length > 0) {
        // Los fragmentos citados por el modelo se cotejan con el texto real: si no aparecen, quedan REJECTED.
        const pages = (await db.select({ text: documentTextPages.text }).from(documentTextPages).where(eq(documentTextPages.documentId, doc!.id))).map((p) => p.text.replace(/\s+/g, " ").toLowerCase());
        const status = (excerpt: string) => {
          if (pages.length === 0) return "MODEL_REPORTED" as const;
          const needle = excerpt.replace(/\s+/g, " ").trim().toLowerCase();
          return pages.some((p) => p.includes(needle)) ? ("TEXT_VERIFIED" as const) : ("REJECTED" as const);
        };
        await db.insert(evaluationEvidence).values(
          output.evidence.map((e) => ({ companyId, evaluationRunId: runId, documentId: doc!.id, sourceField: e.field, pageNumber: e.page, excerpt: e.excerpt.slice(0, 300), verificationStatus: status(e.excerpt) })),
        );
      }
      return JSON.stringify({ status: "OK", reason: output.warnings.join(" | ").slice(0, 300) || "extracción completa", versionId, billingType: output.billingType } satisfies ExtractionResult);
    });
    const result = JSON.parse(resultRef!) as ExtractionResult;
    // La corrida evalúa la versión ACTUAL de la factura (la extraída, o una corrección humana posterior).
    const [inv] = await db.select({ current: invoices.currentVersionId }).from(invoices).where(eq(invoices.id, r.invoiceId));
    if (inv!.current !== r.run.invoiceVersionId) {
      await db.update(evaluationRuns).set({ invoiceVersionId: inv!.current! }).where(and(eq(evaluationRuns.id, runId), eq(evaluationRuns.status, "RUNNING")));
    }
    return result;
  }

  async function engineInput(companyId: string, runId: string, extraction: ExtractionResult): Promise<EngineInput> {
    const r = await loadRun(companyId, runId);
    const [company] = await db.select({ tz: companies.timezone }).from(companies).where(eq(companies.id, companyId));
    const at = now();
    return loadEngineContext(db, {
      companyId,
      invoiceVersionId: r.run.invoiceVersionId,
      now: at,
      fx: { status: "NOT_REQUESTED" },
      detectedBillingType: extraction.billingType,
      fingerprintSecret: deps.fingerprintSecret,
      supportedCurrencies: deps.supportedCurrencies,
      approvals: [],
      period: periodOf(at, company!.tz),
      extraction: { status: extraction.status, reason: extraction.reason },
    });
  }

  async function match(companyId: string, runId: string, extraction: ExtractionResult) {
    const input = await engineInput(companyId, runId, extraction);
    const fp = sha("CONTRACT_MATCH", input.version.id, String(extraction.billingType), ...input.contractCandidates.map((c) => c.versionId).sort());
    await stage(companyId, runId, "CONTRACT_MATCH", fp, "run", async () => {
      const explained = explainCandidates(input);
      if (explained.length > 0) {
        await db
          .insert(evaluationContractCandidates)
          .values(explained.map((e) => ({ companyId, evaluationRunId: runId, ...e })))
          .onConflictDoNothing();
      }
      return JSON.stringify({ candidates: explained.length, selected: explained.find((e) => e.selected)?.contractVersionId ?? null });
    });
  }

  async function validate(companyId: string, runId: string, extraction: ExtractionResult) {
    const input = await engineInput(companyId, runId, extraction);
    const selected = explainCandidates(input).find((e) => e.selected)?.contractVersionId ?? "none";
    const fp = sha("CONTRACT_VALIDATE", input.version.id, selected, String(extraction.billingType));
    // Validación contractual determinista (sin IA en P0): resultado preliminar informativo;
    // la decisión vinculante se recalcula en FINANCIAL_DECISION bajo bloqueo.
    await stage(companyId, runId, "CONTRACT_VALIDATE", fp, "run", () => {
      const pre = decide(input);
      const contractRules = /^(CONTRACT_|HOURLY_|RECURRING_|MILESTONE_|PO_|CATEGORY_|LINE_|BILLING_TYPE)/;
      const failed = pre.checks.filter((c) => contractRules.test(c.ruleCode) && c.outcome !== "PASS").map((c) => c.ruleCode);
      return Promise.resolve(JSON.stringify({ contractChecksFailed: failed }));
    });
  }

  async function financialDecision(companyId: string, runId: string, extraction: ExtractionResult) {
    const r = await loadRun(companyId, runId);
    const fp = sha("FINANCIAL_DECISION", r.run.invoiceVersionId, String(now().getTime()));
    const { resultRef } = await stage(companyId, runId, "FINANCIAL_DECISION", fp, "never", async (stageRunId) => {
      const fx = await deps.evaluations.resolveFx(companyId, r.run.invoiceVersionId);
      const lastAttempt = !deps.attempt || deps.attempt.current >= deps.attempt.max;
      if (fx.status === "UNAVAILABLE" && fx.reason !== "UNSUPPORTED_PAIR" && !lastAttempt) {
        throw new RetryableStageError("FX_UNAVAILABLE", `Tasa FX no disponible (${fx.reason}); se reintentará`);
      }
      const summary = await deps.evaluations.finalize(companyId, runId, {
        actor: SYSTEM,
        fx,
        detectedBillingType: extraction.billingType,
        extraction: { status: extraction.status, reason: extraction.reason },
        stageRunId,
      });
      return JSON.stringify({ visibleOutcome: summary.visibleOutcome, reasonCode: summary.reasonCode, status: summary.status });
    });
    return JSON.parse(resultRef!) as { visibleOutcome: string | null; reasonCode: string | null; status: string };
  }

  // ─────────────────────────── Grafo ───────────────────────────

  const State = Annotation.Root({
    companyId: Annotation<string>(),
    runId: Annotation<string>(),
    extraction: Annotation<ExtractionResult | null>(),
    outcome: Annotation<{ visibleOutcome: string | null; reasonCode: string | null; status: string } | null>(),
  });

  const graph = new StateGraph(State)
    .addNode("extract_classify", async (s) => ({ extraction: await extract(s.companyId, s.runId) }))
    .addNode("contract_match", async (s) => {
      await match(s.companyId, s.runId, s.extraction!);
      return {};
    })
    .addNode("contract_validate", async (s) => {
      await validate(s.companyId, s.runId, s.extraction!);
      return {};
    })
    .addNode("financial_decision", async (s) => ({ outcome: await financialDecision(s.companyId, s.runId, s.extraction!) }))
    .addEdge(START, "extract_classify")
    // Extracción insuficiente: no hay contrato que cotejar; el motor resolverá EN_CORRECCION.
    .addConditionalEdges("extract_classify", (s) => (s.extraction?.status === "OK" ? "contract_match" : "financial_decision"), ["contract_match", "financial_decision"])
    .addEdge("contract_match", "contract_validate")
    .addEdge("contract_validate", "financial_decision")
    .addEdge("financial_decision", END)
    .compile();

  return {
    async run(companyId: string, runId: string) {
      const result = await graph.invoke({ companyId, runId, extraction: null, outcome: null }, { recursionLimit: 10 });
      logger.info({ runId, companyId, outcome: result.outcome?.visibleOutcome }, "Pipeline de análisis completado");
      return result.outcome;
    },
  };
}
