import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { Executor } from "../audit/audit.service.js";
import { budgetReservations, contractHourConsumptions, monthlyBudgets } from "../budgets/budgets.schema.js";
import { contractItems, contracts, contractVersions } from "../contracts/contracts.schema.js";
import { documents } from "../documents/documents.schema.js";
import { documentTextLayers, documentTextPages, invoiceFieldConfirmations } from "../evidence/evidence.schema.js";
import { evidenceFieldsFor, verifyFields } from "../evidence/verifier.js";
import { companies } from "../identity/identity.schema.js";
import { invoiceAttachments, invoiceLines, invoices, invoiceVersions } from "../invoices/invoices.schema.js";
import { approvalMatrixRules, companyPolicies, policyVersions } from "../policies/policies.schema.js";
import { accountCandidatesFromText, accountFingerprint, matchAccount } from "../vendors/account-fingerprint.js";
import { vendorBankAccounts, vendors } from "../vendors/vendors.schema.js";
import { contractPeriodKey, type EngineApproval, type EngineBankMatch, type EngineBudget, type EngineContractCandidate, type EngineInput, type EnginePolicy } from "./decision-engine.js";
import { evaluationRuns } from "./evaluations.schema.js";

/**
 * Carga, con consultas parametrizadas y SIEMPRE filtradas por company_id, todo
 * lo que el DecisionEngine necesita. Los contratos candidatos son únicamente
 * los del proveedor de la factura con versión CONFIRMED vigente: un contrato de
 * otro proveedor/empresa o una sugerencia de IA sin confirmar nunca es candidato.
 */
export async function loadEngineContext(
  exec: Executor,
  args: {
    companyId: string;
    invoiceVersionId: string;
    now: Date;
    fx: EngineInput["fx"];
    detectedBillingType: EngineInput["detectedBillingType"];
    fingerprintSecret: string | undefined;
    supportedCurrencies: ReadonlySet<string>;
    approvals: EngineApproval[];
    period: string;
    extraction?: EngineInput["extraction"];
    /** Presupuestos ya leídos bajo bloqueo (transacción final). */
    lockedBudgets?: { global: EngineBudget | null; byCategory: Record<string, EngineBudget> };
  },
): Promise<EngineInput> {
  const { companyId } = args;
  const [company] = await exec.select({ id: companies.id, baseCurrency: companies.baseCurrency, timezone: companies.timezone }).from(companies).where(eq(companies.id, companyId));
  const [version] = await exec
    .select()
    .from(invoiceVersions)
    .where(and(eq(invoiceVersions.id, args.invoiceVersionId), eq(invoiceVersions.companyId, companyId)));
  if (!company || !version) throw new Error("Contexto de evaluación inexistente");
  const [invoice] = await exec.select().from(invoices).where(and(eq(invoices.id, version.invoiceId), eq(invoices.companyId, companyId)));
  const [vendor] = await exec.select().from(vendors).where(and(eq(vendors.id, invoice!.vendorId), eq(vendors.companyId, companyId)));
  const lines = await exec.select().from(invoiceLines).where(eq(invoiceLines.invoiceVersionId, version.id)).orderBy(asc(invoiceLines.lineNo));
  const attachments = await exec
    .select({ purpose: invoiceAttachments.purpose, milestoneRef: invoiceAttachments.milestoneRef })
    .from(invoiceAttachments)
    .where(and(eq(invoiceAttachments.companyId, companyId), eq(invoiceAttachments.invoiceId, invoice!.id)));

  // Mismo archivo como respaldo de OTRA factura (posible duplicado con distinto número).
  const [doc] = await exec.select({ sha256: documents.sha256 }).from(documents).where(and(eq(documents.id, version.sourceDocumentId), eq(documents.companyId, companyId)));
  const sameContent = await exec
    .selectDistinct({ invoiceId: invoiceVersions.invoiceId })
    .from(invoiceVersions)
    .innerJoin(documents, and(eq(documents.id, invoiceVersions.sourceDocumentId), eq(documents.companyId, invoiceVersions.companyId)))
    .where(and(eq(invoiceVersions.companyId, companyId), eq(documents.sha256, doc!.sha256), ne(invoiceVersions.invoiceId, invoice!.id)));

  // Cuenta de destino por huella HMAC.
  let bankMatch: EngineBankMatch = { kind: "NOT_DECLARED" };
  let matchedAccountNumber: string | null = null;
  if (version.paymentDestinationRaw) {
    const fps = accountCandidatesFromText(version.paymentDestinationRaw).map((n) => accountFingerprint(args.fingerprintSecret, n));
    const rows = fps.length
      ? await exec
          .select({ id: vendorBankAccounts.id, vendorId: vendorBankAccounts.vendorId, status: vendorBankAccounts.status, fingerprint: vendorBankAccounts.accountFingerprint })
          .from(vendorBankAccounts)
          .where(and(eq(vendorBankAccounts.companyId, companyId), inArray(vendorBankAccounts.accountFingerprint, fps)))
      : [];
    const m = matchAccount(version.paymentDestinationRaw, args.fingerprintSecret, rows, vendor!.id);
    bankMatch = m.kind === "MATCHED" ? { kind: "MATCHED", accountId: m.accountId, status: m.status } : { kind: m.kind };
    // Número concreto cuya huella coincidió: es el que debe aparecer en el documento.
    matchedAccountNumber = m.number;
  }

  // Candidatos contractuales: SOLO del proveedor, contrato ACTIVE, versión CONFIRMED vigente en la fecha de referencia.
  const refDate = version.issueDate ?? version.servicePeriodStart;
  const candidateRows = refDate
    ? await exec
        .select({ c: contracts, v: contractVersions })
        .from(contracts)
        .innerJoin(contractVersions, and(eq(contractVersions.contractId, contracts.id), eq(contractVersions.companyId, contracts.companyId)))
        .where(
          and(
            eq(contracts.companyId, companyId),
            eq(contracts.vendorId, vendor!.id),
            eq(contracts.status, "ACTIVE"),
            eq(contractVersions.status, "CONFIRMED"),
            lte(contractVersions.effectiveFrom, refDate),
            or(isNull(contractVersions.effectiveTo), gte(contractVersions.effectiveTo, refDate)),
          ),
        )
    : [];
  const items = candidateRows.length
    ? await exec.select().from(contractItems).where(inArray(contractItems.contractVersionId, candidateRows.map((r) => r.v.id)))
    : [];
  const contractCandidates: EngineContractCandidate[] = [];
  for (const { c, v } of candidateRows) {
    // Uso previo del contrato por OTRAS facturas ya autorizadas (hitos y períodos comprometidos).
    const prior = await exec
      .select({ itemRef: invoiceLines.itemRef, periodStart: invoiceVersions.servicePeriodStart })
      .from(budgetReservations)
      .innerJoin(evaluationRuns, eq(evaluationRuns.id, budgetReservations.authorizingRunId))
      .innerJoin(contractVersions, eq(contractVersions.id, evaluationRuns.selectedContractVersionId))
      .innerJoin(invoiceVersions, eq(invoiceVersions.id, evaluationRuns.invoiceVersionId))
      .leftJoin(invoiceLines, eq(invoiceLines.invoiceVersionId, invoiceVersions.id))
      .where(and(eq(budgetReservations.companyId, companyId), eq(contractVersions.contractId, c.id), ne(budgetReservations.invoiceId, invoice!.id)));
    // Horas ya autorizadas de ESTE contrato en el período contractual del servicio facturado (otras facturas).
    let consumedHoursInPeriod: string | null = null;
    if (version.servicePeriodStart) {
      const key = contractPeriodKey(v.billingFrequency, version.servicePeriodStart);
      const [row] = await exec
        .select({ total: sql<string>`coalesce(sum(${contractHourConsumptions.hours}), 0)::text` })
        .from(contractHourConsumptions)
        .where(
          and(
            eq(contractHourConsumptions.companyId, companyId),
            eq(contractHourConsumptions.contractId, c.id),
            eq(contractHourConsumptions.periodKey, key),
            ne(contractHourConsumptions.invoiceId, invoice!.id),
          ),
        );
      consumedHoursInPeriod = row!.total;
    }
    contractCandidates.push({
      consumedHoursInPeriod,
      contractId: c.id,
      contractRef: c.contractRef,
      billingType: c.billingType,
      categoryId: c.categoryId,
      versionId: v.id,
      currency: v.currency,
      billingFrequency: v.billingFrequency,
      fixedPeriodAmount: v.fixedPeriodAmount,
      quantityCapPerPeriod: v.quantityCapPerPeriod,
      items: items
        .filter((i) => i.contractVersionId === v.id)
        .map((i) => ({ code: i.code, itemKind: i.itemKind, unit: i.unit, agreedQuantity: i.agreedQuantity, unitPrice: i.unitPrice, milestoneRef: i.milestoneRef, agreedAmount: i.agreedAmount })),
      reservedMilestoneRefs: [...new Set(prior.map((p) => p.itemRef).filter((x): x is string => !!x))],
      reservedPeriodStarts: [...new Set(prior.map((p) => p.periodStart).filter((x): x is string => !!x))],
    });
  }

  // Políticas activas con su versión vigente (la más reciente con effective_from <= now).
  const policyRows = await exec
    .select({ p: companyPolicies, pv: policyVersions })
    .from(companyPolicies)
    .innerJoin(policyVersions, and(eq(policyVersions.policyId, companyPolicies.id), eq(policyVersions.companyId, companyPolicies.companyId)))
    .where(
      and(
        eq(companyPolicies.companyId, companyId),
        eq(companyPolicies.active, true),
        lte(policyVersions.effectiveFrom, args.now),
        sql`${policyVersions.versionNo} = (select max(pv2.version_no) from policy_versions pv2 where pv2.policy_id = ${companyPolicies.id} and pv2.effective_from <= ${args.now.toISOString()}::timestamptz)`,
      ),
    );
  const matrix = policyRows.length
    ? await exec
        .select()
        .from(approvalMatrixRules)
        .where(and(eq(approvalMatrixRules.companyId, companyId), eq(approvalMatrixRules.active, true), inArray(approvalMatrixRules.policyVersionId, policyRows.map((r) => r.pv.id))))
        .orderBy(asc(approvalMatrixRules.minAmountExclusive))
    : [];
  const policies: EnginePolicy[] = policyRows.map(({ p, pv }) => ({
    policyId: p.id,
    policyVersionId: pv.id,
    scopeLevel: p.scopeLevel,
    categoryId: p.categoryId,
    vendorId: p.vendorId,
    contractId: p.contractId,
    name: p.name,
    autoApprovalLimitBase: pv.autoApprovalLimitBase,
    hardInvoiceCapBase: pv.hardInvoiceCapBase,
    matrix: matrix.filter((m) => m.policyVersionId === pv.id).map((m) => ({ minAmountExclusive: m.minAmountExclusive, maxAmountInclusive: m.maxAmountInclusive, personaId: m.personaId })),
  }));

  const budgets = args.lockedBudgets ?? (await readBudgets(exec, companyId, args.period, false));

  // Evidencia documental: cada valor usado para decidir se coteja con la capa de texto del ORIGINAL.
  const [layer] = await exec.select({ status: documentTextLayers.status }).from(documentTextLayers).where(and(eq(documentTextLayers.documentId, version.sourceDocumentId), eq(documentTextLayers.companyId, companyId)));
  const pages = layer?.status === "TEXT"
    ? (await exec.select({ text: documentTextPages.text }).from(documentTextPages).where(eq(documentTextPages.documentId, version.sourceDocumentId)).orderBy(asc(documentTextPages.pageNo))).map((p) => p.text)
    : [];
  const confirmations = await exec
    .select({ field: invoiceFieldConfirmations.field, value: invoiceFieldConfirmations.confirmedValue })
    .from(invoiceFieldConfirmations)
    .where(and(eq(invoiceFieldConfirmations.invoiceVersionId, version.id), eq(invoiceFieldConfirmations.companyId, companyId)));
  const fieldEvidence = verifyFields(
    { status: layer?.status ?? "MISSING", pages },
    evidenceFieldsFor({ ...version, currency: version.originalCurrency, lines: lines.map((l) => ({ lineNo: l.lineNo, itemRef: l.itemRef, quantity: l.quantity, unitPrice: l.unitPrice, subtotal: l.subtotal })) }, matchedAccountNumber),
    new Map(confirmations.map((c) => [c.field, c.value])),
  );

  return {
    now: args.now,
    company,
    invoice: { id: invoice!.id, vendorId: vendor!.id, categoryId: invoice!.categoryId, duplicateOfInvoiceId: invoice!.duplicateOfInvoiceId, sameContentInvoiceIds: sameContent.map((s) => s.invoiceId) },
    version: {
      id: version.id,
      supplierInvoiceNumber: version.supplierInvoiceNumber,
      issuerTaxReference: version.issuerTaxReference,
      issueDate: version.issueDate,
      servicePeriodStart: version.servicePeriodStart,
      servicePeriodEnd: version.servicePeriodEnd,
      currency: version.originalCurrency,
      subtotal: version.subtotal,
      taxes: version.taxes,
      discounts: version.discounts,
      totalAmount: version.totalAmount,
      contractRefCited: version.contractRefCited,
      lines: lines.map((l) => ({ lineNo: l.lineNo, concept: l.concept, itemRef: l.itemRef, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, subtotal: l.subtotal })),
    },
    attachments,
    vendor: { id: vendor!.id, status: vendor!.status, taxReference: vendor!.taxReference },
    bankMatch,
    detectedBillingType: args.detectedBillingType,
    contractCandidates,
    policies,
    fx: args.fx,
    budgets: { period: args.period, ...budgets },
    approvals: args.approvals,
    supportedCurrencies: args.supportedCurrencies,
    extraction: args.extraction ?? null,
    evidence: { documentId: version.sourceDocumentId, layerStatus: layer?.status ?? "MISSING", fields: fieldEvidence },
  };
}

/**
 * Lee los presupuestos del mes. Con `lock`, bloquea en ORDEN FIJO: primero el
 * global y después las categorías por id (evita interbloqueos entre autorizaciones).
 */
export async function readBudgets(exec: Executor, companyId: string, period: string, lock: boolean, categoryId?: string | null) {
  const globalQ = exec
    .select({ id: monthlyBudgets.id, limitBase: monthlyBudgets.limitBase, reservedBase: monthlyBudgets.reservedBase })
    .from(monthlyBudgets)
    .where(and(eq(monthlyBudgets.companyId, companyId), eq(monthlyBudgets.periodYyyyMm, period), eq(monthlyBudgets.scope, "GLOBAL")));
  const [global] = lock ? await globalQ.for("update") : await globalQ;
  const catQ = exec
    .select({ id: monthlyBudgets.id, categoryId: monthlyBudgets.categoryId, limitBase: monthlyBudgets.limitBase, reservedBase: monthlyBudgets.reservedBase })
    .from(monthlyBudgets)
    .where(
      and(
        eq(monthlyBudgets.companyId, companyId),
        eq(monthlyBudgets.periodYyyyMm, period),
        eq(monthlyBudgets.scope, "CATEGORY"),
        lock && categoryId ? eq(monthlyBudgets.categoryId, categoryId) : undefined,
      ),
    )
    .orderBy(asc(monthlyBudgets.id));
  const cats = lock ? (categoryId ? await catQ.for("update") : []) : await catQ;
  const byCategory: Record<string, EngineBudget> = {};
  for (const c of cats) byCategory[c.categoryId!] = { id: c.id, limitBase: c.limitBase, reservedBase: c.reservedBase };
  return { global: global ?? null, byCategory };
}

export async function latestRunForInvoice(exec: Executor, companyId: string, invoiceId: string) {
  const [row] = await exec
    .select({ run: evaluationRuns })
    .from(evaluationRuns)
    .innerJoin(invoiceVersions, eq(invoiceVersions.id, evaluationRuns.invoiceVersionId))
    .where(and(eq(evaluationRuns.companyId, companyId), eq(invoiceVersions.invoiceId, invoiceId), eq(evaluationRuns.status, "COMPLETED")))
    .orderBy(desc(evaluationRuns.evaluatedAt))
    .limit(1);
  return row?.run;
}
