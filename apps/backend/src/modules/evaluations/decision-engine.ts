import { D, toMoney4, toReserveAmount, type Dec } from "../../shared/money.js";
import type { BillingType } from "../contracts/contracts.schema.js";
import type { AttachmentPurpose } from "../invoices/invoices.schema.js";
import type { PolicyScope } from "../policies/policies.schema.js";
import type { VendorStatus } from "../vendors/vendors.schema.js";
import { evidenceRuleCode, type FieldEvidence } from "../evidence/verifier.js";
import type { CheckEffect, CheckOutcome, EngineDecision, VisibleOutcome } from "./evaluations.schema.js";

/**
 * DecisionEngine determinista (ARCH-008). Función PURA: no hace IO, no llama
 * a modelos de IA y no confía en puntuaciones; decide solo con datos tipados
 * cargados por el backend. La misma entrada produce siempre la misma salida.
 */
export const ENGINE_VERSION = "decision-engine/1.1.0";

// ───────────────────────────── Entrada ─────────────────────────────

export interface EngineLine {
  lineNo: number;
  concept: string;
  itemRef: string | null;
  quantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  subtotal: string;
}

export interface EngineContractItem {
  code: string;
  itemKind: "FIXED_FEE" | "HOURLY_RATE" | "MILESTONE" | "PO_LINE";
  unit: string | null;
  agreedQuantity: string | null;
  unitPrice: string | null;
  milestoneRef: string | null;
  agreedAmount: string | null;
}

export interface EngineContractCandidate {
  contractId: string;
  contractRef: string;
  billingType: BillingType;
  categoryId: string;
  versionId: string;
  currency: string;
  billingFrequency: string | null;
  fixedPeriodAmount: string | null;
  quantityCapPerPeriod: string | null;
  items: EngineContractItem[];
  /** Hitos de este contrato ya comprometidos por otras facturas autorizadas. */
  reservedMilestoneRefs: string[];
  /** Inicios de período ya comprometidos por otras facturas (recurrentes). */
  reservedPeriodStarts: string[];
  /**
   * Horas ya AUTORIZADAS de este contrato (otras facturas) en el período
   * contractual que contiene el inicio del período de servicio de esta factura.
   * null = no aplica (sin período de servicio).
   */
  consumedHoursInPeriod: string | null;
}

export interface EnginePolicy {
  policyId: string;
  policyVersionId: string;
  scopeLevel: PolicyScope;
  categoryId: string | null;
  vendorId: string | null;
  contractId: string | null;
  name: string;
  autoApprovalLimitBase: string | null;
  hardInvoiceCapBase: string | null;
  matrix: Array<{ minAmountExclusive: string; maxAmountInclusive: string | null; personaId: string }>;
}

export interface EngineBudget {
  id: string;
  limitBase: string;
  reservedBase: string;
}

export type EngineFx =
  | { status: "OK"; snapshotId: string; rate: string; provider: string; isSimulated: boolean; validUntil: Date }
  | { status: "UNAVAILABLE"; reason: string }
  | { status: "NOT_REQUESTED" };

export type EngineBankMatch =
  | { kind: "NOT_DECLARED" }
  | { kind: "UNREGISTERED" }
  | { kind: "OTHER_VENDOR" }
  | { kind: "MATCHED"; accountId: string; status: VendorStatus };

export interface EngineApproval {
  approvalRequestId: string;
  invoiceVersionId: string;
  amountBase: string;
  personaId: string;
}

export interface EngineInput {
  now: Date;
  company: { id: string; baseCurrency: string; timezone: string };
  invoice: { id: string; vendorId: string; categoryId: string | null; duplicateOfInvoiceId: string | null; sameContentInvoiceIds: string[] };
  version: {
    id: string;
    supplierInvoiceNumber: string | null;
    issuerTaxReference: string | null;
    issueDate: string | null;
    servicePeriodStart: string | null;
    servicePeriodEnd: string | null;
    currency: string | null;
    subtotal: string | null;
    taxes: string | null;
    discounts: string | null;
    totalAmount: string | null;
    contractRefCited: string | null;
    lines: EngineLine[];
  };
  attachments: Array<{ purpose: AttachmentPurpose; milestoneRef: string | null }>;
  vendor: { id: string; status: VendorStatus; taxReference: string | null };
  bankMatch: EngineBankMatch;
  /** Modalidad detectada por la extracción (B4); null = no hubo extracción (se infiere del contrato). */
  detectedBillingType: BillingType | "UNKNOWN" | "MIXED" | null;
  contractCandidates: EngineContractCandidate[];
  policies: EnginePolicy[];
  fx: EngineFx;
  budgets: { period: string; global: EngineBudget | null; byCategory: Record<string, EngineBudget> };
  approvals: EngineApproval[];
  /** Divisas ISO 4217 admitidas por la empresa/demo. */
  supportedCurrencies: ReadonlySet<string>;
  /** Resultado de la extracción asistida (B4); ausente en evaluaciones manuales. */
  extraction?: { status: "OK" | "INSUFFICIENT"; reason: string } | null;
  /** Cotejo determinista de cada valor con la capa de texto del documento original. */
  evidence: { documentId: string; layerStatus: string; fields: FieldEvidence[] };
}

// ───────────────────────────── Salida ─────────────────────────────

export interface EngineCheck {
  ruleCode: string;
  outcome: CheckOutcome;
  effect: CheckEffect;
  observedText?: string | null;
  expectedText?: string | null;
  observedAmount?: string | null;
  expectedAmount?: string | null;
  currency?: string | null;
  reason: string;
}

export interface EngineResult {
  engineVersion: string;
  decision: EngineDecision | null;
  visibleOutcome: Exclude<VisibleOutcome, "RECHAZADA">;
  reasonCode: string;
  checks: EngineCheck[];
  period: string;
  amountBase: string | null;
  fxSnapshotId: string | null;
  effectiveCategoryId: string | null;
  selectedContract: EngineContractCandidate | null;
  matchedBankAccountId: string | null;
  appliedPolicies: Array<{ policyVersionId: string; reason: string }>;
  /** Presente si el resultado es EN_APROBACION por importe (para crear approval_request en B5). */
  approvalRequired: { personaId: string; amountBase: string } | null;
  budgetsToReserve: { global: EngineBudget; category: EngineBudget } | null;
  /** Resultado de la verificación documental por campo (se persiste como evaluation_evidence). */
  fieldEvidence: FieldEvidence[];
  /** Horas a registrar en el ledger contractual si se autoriza (HOURLY). */
  hoursToConsume: { contractId: string; periodKey: string; hours: string } | null;
}

// ───────────────────────────── Utilidades ─────────────────────────────

/**
 * Período CONTRACTUAL (no presupuestario) que contiene una fecha de prestación:
 * MONTHLY → YYYY-MM, QUARTERLY → YYYY-Qn, ANNUAL → YYYY. Por defecto mensual.
 */
export function contractPeriodKey(frequency: string | null, isoDate: string): string {
  const [y, m] = isoDate.split("-");
  if (frequency === "ANNUAL") return y!;
  if (frequency === "QUARTERLY") return `${y}-Q${Math.floor((Number(m) - 1) / 3) + 1}`;
  return `${y}-${m}`;
}

/** Mes calendario local (YYYY-MM) de un instante en la zona horaria de la empresa (ARCH-012). */
export function periodOf(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit" }).formatToParts(instant);
  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  return `${year}-${month}`;
}

const norm = (v: string | null | undefined) => (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const eqDec = (a: string, b: string) => new D(a).eq(new D(b));

class CheckList {
  readonly items: EngineCheck[] = [];
  pass(ruleCode: string, reason: string, extra: Partial<EngineCheck> = {}) {
    this.items.push({ ruleCode, outcome: "PASS", effect: "INFO", reason, ...extra });
  }
  fail(ruleCode: string, effect: CheckEffect, reason: string, extra: Partial<EngineCheck> = {}) {
    this.items.push({ ruleCode, outcome: "FAIL", effect, reason, ...extra });
  }
  unknown(ruleCode: string, effect: CheckEffect, reason: string, extra: Partial<EngineCheck> = {}) {
    this.items.push({ ruleCode, outcome: "UNKNOWN", effect, reason, ...extra });
  }
}

// ───────────────────────────── Motor ─────────────────────────────

export function decide(input: EngineInput): EngineResult {
  const c = new CheckList();
  const v = input.version;
  const period = periodOf(input.now, input.company.timezone);

  // 0. Calidad documental de la extracción (si la hubo): insuficiente ⇒ corrección, nunca suposición.
  if (input.extraction?.status === "INSUFFICIENT") {
    c.fail("EXTRACTION_QUALITY", "CORRECTION", `No se pudieron extraer datos fiables del documento: ${input.extraction.reason}`);
  } else if (input.extraction?.status === "OK") {
    c.pass("EXTRACTION_QUALITY", "Datos extraídos con salida estructurada validada");
  }

  // 0b. Evidencia documental obligatoria: ningún valor usado para decidir puede carecer de respaldo
  //     en el documento original. NOT_FOUND = discrepancia (posible dato inventado) → corrección;
  //     UNVERIFIABLE (sin capa de texto) → corroboración humana pendiente → corrección.
  for (const e of input.evidence.fields) {
    const rule = evidenceRuleCode(e.field);
    const where = e.page ? `pág. ${e.page}: «${e.excerpt}»` : null;
    if (e.status === "TEXT_VERIFIED") c.pass(rule, `Valor localizado en el documento (${where})`, { observedText: e.value, expectedText: where });
    else if (e.status === "HUMAN_CONFIRMED") c.pass(rule, "Documento sin texto digital: valor confirmado por una persona autenticada", { observedText: e.value });
    else if (e.status === "NOT_FOUND")
      c.fail(rule, "CORRECTION", `El valor registrado no aparece en el documento original${e.critical ? " (campo crítico)" : ""}`, { observedText: e.value, expectedText: "presente en el documento" });
    else c.unknown(rule, "CORRECTION", `Documento sin texto verificable (${input.evidence.layerStatus}): requiere confirmación humana del valor`, { observedText: e.value });
  }

  // Defensa en profundidad: un campo crítico con valor DEBE tener entrada de evidencia.
  const critical: Array<[string, string | null]> = [
    ["supplierInvoiceNumber", v.supplierInvoiceNumber],
    ["totalAmount", v.totalAmount],
    ["currency", v.currency],
    ["issueDate", v.issueDate],
    ["paymentAccount", input.bankMatch.kind === "MATCHED" ? "matched" : null],
  ];
  for (const [field, value] of critical) {
    if (value !== null && !input.evidence.fields.some((e) => e.field === field)) {
      c.unknown("EVIDENCE_MISSING", "CORRECTION", `Sin verificación documental del campo crítico ${field}`, { observedText: field });
    }
  }

  // 1. Identidad y duplicados.
  if (input.invoice.duplicateOfInvoiceId) {
    c.fail("DUPLICATE_INVOICE", "BLOCK", "Ya existe una factura del mismo proveedor con el mismo número normalizado", {
      observedText: v.supplierInvoiceNumber,
      expectedText: `factura única (duplicada de ${input.invoice.duplicateOfInvoiceId})`,
    });
  } else if (!v.supplierInvoiceNumber) {
    c.unknown("INVOICE_NUMBER_PRESENT", "CORRECTION", "Falta el número de factura: no se puede controlar la duplicidad");
  } else {
    c.pass("INVOICE_NUMBER_PRESENT", "Número de factura identificado", { observedText: v.supplierInvoiceNumber });
  }
  if (input.invoice.sameContentInvoiceIds.length > 0) {
    c.fail("POSSIBLE_DUPLICATE_DOCUMENT", "CORRECTION", "El mismo archivo ya respalda otra factura; requiere revisión", {
      observedText: input.invoice.sameContentInvoiceIds.join(","),
    });
  }

  // 2. Proveedor y documento.
  switch (input.vendor.status) {
    case "BLOCKED":
      c.fail("VENDOR_STATUS", "BLOCK", "Proveedor expresamente bloqueado", { observedText: "BLOCKED", expectedText: "AUTHORIZED" });
      break;
    case "PENDING":
      c.fail("VENDOR_STATUS", "ENABLEMENT", "Proveedor pendiente: debe autorizarse explícitamente antes de reevaluar", { observedText: "PENDING", expectedText: "AUTHORIZED" });
      break;
    case "AUTHORIZED":
      c.pass("VENDOR_STATUS", "Proveedor autorizado");
  }
  if (v.issuerTaxReference && input.vendor.taxReference) {
    if (norm(v.issuerTaxReference) === norm(input.vendor.taxReference)) c.pass("ISSUER_MATCHES_VENDOR", "La identificación del emisor coincide con el proveedor");
    else
      c.fail("ISSUER_MATCHES_VENDOR", "CORRECTION", "La identificación fiscal del documento no coincide con el proveedor seleccionado", {
        observedText: v.issuerTaxReference,
        expectedText: input.vendor.taxReference,
      });
  }

  // 3. Cuenta de destino.
  let matchedBankAccountId: string | null = null;
  switch (input.bankMatch.kind) {
    case "NOT_DECLARED":
      c.unknown("BANK_ACCOUNT", "CORRECTION", "La factura no identifica una cuenta de destino verificable");
      break;
    case "UNREGISTERED":
      c.fail("BANK_ACCOUNT", "ENABLEMENT", "Cuenta de destino no registrada: debe registrarse y autorizarse antes de reevaluar");
      break;
    case "OTHER_VENDOR":
      c.fail("BANK_ACCOUNT", "BLOCK", "La cuenta de destino pertenece a otro proveedor");
      break;
    case "MATCHED":
      matchedBankAccountId = input.bankMatch.accountId;
      if (input.bankMatch.status === "AUTHORIZED") c.pass("BANK_ACCOUNT", "Cuenta de destino registrada y autorizada");
      else if (input.bankMatch.status === "BLOCKED") c.fail("BANK_ACCOUNT", "BLOCK", "Cuenta de destino expresamente bloqueada", { observedText: "BLOCKED" });
      else c.fail("BANK_ACCOUNT", "ENABLEMENT", "Cuenta de destino pendiente: debe autorizarse explícitamente", { observedText: "PENDING" });
  }

  // 4. Datos financieros críticos.
  const currencyOk = !!v.currency && input.supportedCurrencies.has(v.currency);
  if (!v.currency) c.unknown("CURRENCY_PRESENT", "CORRECTION", "Falta la moneda de la factura");
  else if (!currencyOk) c.fail("CURRENCY_PRESENT", "CORRECTION", "Moneda desconocida o no admitida", { observedText: v.currency });
  else c.pass("CURRENCY_PRESENT", "Moneda identificada", { observedText: v.currency });

  let total: Dec | null = null;
  if (!v.totalAmount) c.unknown("TOTAL_PRESENT", "CORRECTION", "Falta el importe total");
  else {
    total = new D(v.totalAmount);
    if (total.lte(0)) {
      c.fail("TOTAL_PRESENT", "CORRECTION", "El importe total debe ser positivo", { observedAmount: v.totalAmount });
      total = null;
    } else c.pass("TOTAL_PRESENT", "Importe total identificado", { observedAmount: toMoney4(total), currency: v.currency });
  }
  if (total && v.subtotal) {
    const expected = new D(v.subtotal).plus(v.taxes ?? "0").minus(v.discounts ?? "0");
    if (expected.eq(total)) c.pass("TOTAL_ARITHMETIC", "Subtotal + impuestos − descuentos = total");
    else c.fail("TOTAL_ARITHMETIC", "CORRECTION", "Los importes de la factura no cuadran", { observedAmount: toMoney4(total), expectedAmount: toMoney4(expected), currency: v.currency });
  }
  if (v.lines.length > 0 && v.subtotal) {
    const sum = v.lines.reduce((acc, l) => acc.plus(l.subtotal), new D(0));
    if (sum.eq(v.subtotal)) c.pass("LINES_SUM", "La suma de líneas coincide con el subtotal");
    else c.fail("LINES_SUM", "CORRECTION", "La suma de líneas no coincide con el subtotal", { observedAmount: toMoney4(sum), expectedAmount: toMoney4(new D(v.subtotal)), currency: v.currency });
  }
  const referenceDate = v.issueDate ?? v.servicePeriodStart;
  if (!referenceDate) c.unknown("ISSUE_DATE_PRESENT", "CORRECTION", "Falta la fecha de emisión: no se puede verificar la vigencia del contrato");
  else c.pass("ISSUE_DATE_PRESENT", "Fecha de referencia identificada", { observedText: referenceDate });

  // 5. Contrato: solo candidatos CONFIRMED del MISMO proveedor (los carga el backend).
  const selected = selectContract(input, c);
  const hold: { hoursToConsume: EngineResult["hoursToConsume"] } = { hoursToConsume: null };
  // Solo una categoría validada contra el contrato determina presupuesto y políticas de categoría.
  let effectiveCategoryId: string | null = null;
  if (selected) {
    if (v.currency && selected.currency !== v.currency) {
      c.fail("CONTRACT_CURRENCY", "CORRECTION", "La moneda de la factura no coincide con la del contrato", { observedText: v.currency, expectedText: selected.currency });
    } else if (v.currency) c.pass("CONTRACT_CURRENCY", "Moneda conforme al contrato");
    if (!input.invoice.categoryId) {
      effectiveCategoryId = selected.categoryId;
      c.pass("CATEGORY_MATCH", "Categoría presupuestaria tomada del contrato validado", { observedText: selected.categoryId });
    } else if (input.invoice.categoryId === selected.categoryId) {
      effectiveCategoryId = selected.categoryId;
      c.pass("CATEGORY_MATCH", "Categoría conforme al contrato");
    } else if (input.invoice.categoryId !== selected.categoryId) {
      c.fail("CATEGORY_MATCH", "CORRECTION", "La categoría de la factura difiere de la del contrato", { observedText: input.invoice.categoryId, expectedText: selected.categoryId });
      // Sin categoría resuelta no se evalúa (ni reserva) ningún presupuesto de categoría.
      effectiveCategoryId = null;
    }
    validateModality(input, selected, total, c, hold);
  }

  // 6. FX y conversión a moneda base (nunca tasa inventada).
  let amountBase: Dec | null = null;
  let fxSnapshotId: string | null = null;
  if (total && currencyOk) {
    if (input.fx.status === "OK") {
      if (input.fx.validUntil.getTime() <= input.now.getTime()) {
        c.fail("FX_RATE", "ERROR", "La tasa FX disponible ya no es válida", { observedText: input.fx.provider });
      } else {
        fxSnapshotId = input.fx.snapshotId;
        amountBase = new D(toReserveAmount(total.times(input.fx.rate)));
        c.pass("FX_RATE", v.currency === input.company.baseCurrency ? "Misma moneda que la base: tasa identidad 1" : "Tasa FX válida registrada", {
          observedText: `${v.currency}→${input.company.baseCurrency} ${input.fx.rate} (${input.fx.provider}${input.fx.isSimulated ? ", SIMULADA" : ""})`,
          observedAmount: toMoney4(amountBase),
          currency: input.company.baseCurrency,
        });
      }
    } else if (input.fx.status === "UNAVAILABLE") {
      c.fail("FX_RATE", "ERROR", `No hay tasa FX utilizable (${input.fx.reason}); error técnico recuperable`, { observedText: `${v.currency}→${input.company.baseCurrency}` });
    } else {
      c.unknown("FX_RATE", "ERROR", "No se solicitó la tasa FX");
    }
  }

  // 7. Políticas acumulativas: la más estricta domina; una específica nunca relaja la global.
  const applicable = input.policies.filter(
    (p) =>
      p.scopeLevel === "COMPANY" ||
      (p.scopeLevel === "CATEGORY" && p.categoryId === effectiveCategoryId) ||
      (p.scopeLevel === "VENDOR" && p.vendorId === input.vendor.id) ||
      (p.scopeLevel === "CONTRACT" && !!selected && p.contractId === selected.contractId),
  );
  const appliedPolicies = applicable.map((p) => ({ policyVersionId: p.policyVersionId, reason: `${p.scopeLevel}: ${p.name}` }));
  const companyPolicy = applicable.find((p) => p.scopeLevel === "COMPANY");
  const minOf = (vals: Array<string | null>) =>
    vals.filter((x): x is string => x !== null).reduce<Dec | null>((m, x) => (m === null || new D(x).lt(m) ? new D(x) : m), null);
  const hardCap = minOf(applicable.map((p) => p.hardInvoiceCapBase));
  const autoLimit = minOf(applicable.map((p) => p.autoApprovalLimitBase));
  let approvalRequired: EngineResult["approvalRequired"] = null;

  if (!companyPolicy) {
    c.fail("POLICY_CONFIGURED", "CORRECTION", "No hay política empresarial vigente: no se puede autorizar");
  } else if (amountBase) {
    const base = input.company.baseCurrency;
    if (hardCap && amountBase.gt(hardCap)) {
      c.fail("HARD_INVOICE_CAP", "BLOCK", "El importe supera el tope absoluto por factura; ninguna aprobación lo habilita", {
        observedAmount: toMoney4(amountBase),
        expectedAmount: toMoney4(hardCap),
        currency: base,
      });
    } else c.pass("HARD_INVOICE_CAP", "Importe dentro del tope absoluto", { observedAmount: toMoney4(amountBase), expectedAmount: hardCap ? toMoney4(hardCap) : null, currency: base });

    if (autoLimit && amountBase.gt(autoLimit)) {
      // Matriz empresarial: reglas de TODAS las políticas de empresa aplicables; sin suposiciones.
      const covering = applicable
        .filter((p) => p.scopeLevel === "COMPANY")
        .flatMap((p) => p.matrix)
        .filter((r) => amountBase.gt(r.minAmountExclusive) && (r.maxAmountInclusive === null || amountBase.lte(r.maxAmountInclusive)));
      const personas = [...new Set(covering.map((r) => r.personaId))];
      const rule = personas.length === 1 ? covering[0] : undefined;
      if (personas.length > 1) {
        c.fail("APPROVAL_MATRIX", "CORRECTION", "Varias reglas de la matriz asignan responsables distintos a este importe", { observedAmount: toMoney4(amountBase), currency: base, observedText: personas.join(",") });
      } else if (!rule) {
        c.fail("APPROVAL_MATRIX", "CORRECTION", "Ningún responsable de la matriz cubre este importe", { observedAmount: toMoney4(amountBase), currency: base });
      } else {
        const approved = input.approvals.find((a) => a.invoiceVersionId === v.id && a.personaId === rule.personaId && amountBase.lte(a.amountBase));
        if (approved) {
          c.pass("APPROVAL_REQUIRED", "Aprobación simulada vigente para esta versión e importe", { observedText: approved.approvalRequestId, observedAmount: toMoney4(amountBase), currency: base });
        } else {
          approvalRequired = { personaId: rule.personaId, amountBase: toMoney4(amountBase) };
          c.fail("APPROVAL_REQUIRED", "APPROVAL", "El importe supera el límite de autorización automática; requiere aprobación", {
            observedAmount: toMoney4(amountBase),
            expectedAmount: toMoney4(autoLimit),
            expectedText: rule.personaId,
            currency: base,
          });
        }
      }
    } else c.pass("AUTO_APPROVAL_LIMIT", "Importe dentro del límite de autorización automática", { observedAmount: toMoney4(amountBase), expectedAmount: autoLimit ? toMoney4(autoLimit) : null, currency: base });
  }

  // 8. Presupuestos del MES DE AUTORIZACIÓN (zona horaria de la empresa): global y categoría.
  let budgetsToReserve: EngineResult["budgetsToReserve"] = null;
  if (amountBase && effectiveCategoryId) {
    const base = input.company.baseCurrency;
    const check = (rule: string, label: string, b: EngineBudget | null | undefined) => {
      if (!b) {
        c.fail(rule, "BLOCK", `No existe presupuesto ${label} para ${period}`, { observedText: period });
        return false;
      }
      const available = new D(b.limitBase).minus(b.reservedBase);
      if (available.lt(amountBase)) {
        c.fail(rule, "BLOCK", `Presupuesto ${label} insuficiente en ${period}`, { observedAmount: toMoney4(amountBase), expectedAmount: toMoney4(available), currency: base, observedText: period });
        return false;
      }
      c.pass(rule, `Presupuesto ${label} suficiente en ${period}`, { observedAmount: toMoney4(amountBase), expectedAmount: toMoney4(available), currency: base, observedText: period });
      return true;
    };
    const g = check("BUDGET_GLOBAL", "global", input.budgets.global);
    const cat = input.budgets.byCategory[effectiveCategoryId];
    const k = check("BUDGET_CATEGORY", "de categoría", cat);
    if (g && k) budgetsToReserve = { global: input.budgets.global!, category: cat! };
  }

  // 9. Resultado por precedencia: BLOCK > ERROR > EN_CORRECCION > EN_APROBACION > AUTORIZADA.
  const failing = c.items.filter((x) => x.outcome !== "PASS" && x.effect !== "INFO");
  const first = (effect: CheckEffect) => failing.find((x) => x.effect === effect);
  const base = {
    engineVersion: ENGINE_VERSION,
    fieldEvidence: input.evidence.fields,
    checks: c.items,
    period,
    amountBase: amountBase ? toMoney4(amountBase) : null,
    fxSnapshotId,
    effectiveCategoryId,
    selectedContract: selected,
    matchedBankAccountId,
    appliedPolicies,
  };
  const block = first("BLOCK");
  const none = { approvalRequired: null, budgetsToReserve: null, hoursToConsume: null };
  if (block) return { ...base, ...none, decision: "BLOCK", visibleOutcome: "BLOQUEADA", reasonCode: block.ruleCode };
  const error = first("ERROR");
  if (error) return { ...base, ...none, decision: null, visibleOutcome: "ERROR", reasonCode: error.ruleCode };
  const correction = first("CORRECTION");
  if (correction) return { ...base, ...none, decision: "ESCALATE", visibleOutcome: "EN_CORRECCION", reasonCode: correction.ruleCode };
  const enablement = first("ENABLEMENT");
  const approval = first("APPROVAL");
  if (enablement || approval) {
    return {
      ...base,
      decision: "ESCALATE",
      visibleOutcome: "EN_APROBACION",
      reasonCode: (enablement ?? approval)!.ruleCode,
      // Si falta habilitar proveedor/cuenta, aprobar la factura no basta: no se pide aprobación de importe todavía.
      approvalRequired: enablement ? null : approvalRequired,
      budgetsToReserve: null,
      hoursToConsume: null,
    };
  }
  if (!selected || !matchedBankAccountId || !amountBase || !budgetsToReserve) {
    // Defensa: nunca autorizar sin contrato, cuenta, importe y presupuestos verificados.
    return { ...base, ...none, decision: "ESCALATE", visibleOutcome: "EN_CORRECCION", reasonCode: "INCOMPLETE_EVALUATION" };
  }
  return { ...base, decision: "AUTHORIZE", visibleOutcome: "AUTORIZADA", reasonCode: "ALL_CHECKS_PASSED", approvalRequired: null, budgetsToReserve, hoursToConsume: hold.hoursToConsume };
}

/** Búsqueda contractual determinista: modalidad → referencia citada → unicidad. Ambiguo ⇒ corrección. */
function selectContract(input: EngineInput, c: CheckList): EngineContractCandidate | null {
  const detected = input.detectedBillingType;
  if (detected === "UNKNOWN" || detected === "MIXED") {
    c.fail("BILLING_TYPE", "CORRECTION", "No se pudo determinar una única modalidad de facturación", { observedText: detected });
    return null;
  }
  const all = input.contractCandidates;
  if (all.length === 0) {
    c.fail("CONTRACT_FOUND", "CORRECTION", "No hay contrato confirmado y vigente de este proveedor para la fecha de la factura");
    return null;
  }
  const typed = detected ? all.filter((x) => x.billingType === detected) : all;
  if (typed.length === 0) {
    c.fail("CONTRACT_TYPE_MATCH", "CORRECTION", "El proveedor no tiene contrato vigente de la modalidad facturada", {
      observedText: detected,
      expectedText: [...new Set(all.map((x) => x.billingType))].join(","),
    });
    return null;
  }
  let pool = typed;
  const cited = input.version.contractRefCited;
  if (cited) {
    const byRef = typed.filter((x) => norm(x.contractRef) === norm(cited));
    if (byRef.length === 0) {
      c.fail("CONTRACT_REF_MATCH", "CORRECTION", "La referencia de contrato citada no corresponde a ningún contrato vigente del proveedor", {
        observedText: cited,
        expectedText: typed.map((x) => x.contractRef).join(","),
      });
      return null;
    }
    pool = byRef;
  }
  if (pool.length > 1) {
    c.fail("CONTRACT_AMBIGUOUS", "CORRECTION", "Varios contratos podrían corresponder; no se selecciona por suposición", { observedText: pool.map((x) => x.contractRef).join(",") });
    return null;
  }
  const selected = pool[0]!;
  c.pass("CONTRACT_FOUND", "Contrato confirmado y vigente del proveedor seleccionado", { observedText: `${selected.contractRef} (${selected.billingType})` });
  return selected;
}

/** Validadores tipados por modalidad (ER §B). */
function validateModality(input: EngineInput, k: EngineContractCandidate, total: Dec | null, c: CheckList, hold: { hoursToConsume: EngineResult["hoursToConsume"] }): void {
  const v = input.version;
  const cur = v.currency;
  switch (k.billingType) {
    case "HOURLY": {
      const rates = k.items.filter((i) => i.itemKind === "HOURLY_RATE");
      if (v.lines.length === 0) {
        c.unknown("HOURLY_LINES", "CORRECTION", "La factura por horas no detalla líneas con cantidad y tarifa");
        break;
      }
      let hours = new D(0);
      for (const line of v.lines) {
        if (!line.quantity || !line.unitPrice || !line.unit) {
          c.unknown("HOURLY_LINE_DATA", "CORRECTION", `Línea ${line.lineNo}: falta cantidad, unidad o tarifa verificable`, { observedText: line.concept });
          continue;
        }
        if (norm(line.unit) !== "HOUR" && norm(line.unit) !== "HOURS" && norm(line.unit) !== "H" && norm(line.unit) !== "HORA" && norm(line.unit) !== "HORAS") {
          c.fail("HOURLY_UNIT", "CORRECTION", `Línea ${line.lineNo}: unidad no horaria`, { observedText: line.unit, expectedText: "HOUR" });
          continue;
        }
        const rate = line.itemRef ? rates.find((r) => norm(r.code) === norm(line.itemRef)) : rates.length === 1 ? rates[0] : undefined;
        if (!rate) {
          c.fail("HOURLY_RATE_ITEM", "CORRECTION", `Línea ${line.lineNo}: no se identifica la tarifa contractual aplicable`, { observedText: line.itemRef ?? line.concept });
          continue;
        }
        if (!eqDec(line.unitPrice, rate.unitPrice!)) {
          const diff = new D(line.unitPrice).minus(rate.unitPrice!);
          c.fail("HOURLY_RATE", "CORRECTION", `Línea ${line.lineNo}: tarifa facturada distinta de la pactada (diferencia ${toMoney4(diff)} ${cur ?? ""} por hora)`, {
            observedAmount: line.unitPrice,
            expectedAmount: rate.unitPrice,
            currency: cur,
          });
        } else c.pass("HOURLY_RATE", `Línea ${line.lineNo}: tarifa conforme`, { observedAmount: line.unitPrice, expectedAmount: rate.unitPrice, currency: cur });
        const expectedSubtotal = new D(line.quantity).times(line.unitPrice);
        if (!expectedSubtotal.eq(line.subtotal)) {
          c.fail("LINE_ARITHMETIC", "CORRECTION", `Línea ${line.lineNo}: cantidad × tarifa ≠ subtotal`, { observedAmount: line.subtotal, expectedAmount: toMoney4(expectedSubtotal), currency: cur });
        }
        hours = hours.plus(line.quantity);
      }
      // Tope ACUMULADO: horas ya autorizadas del contrato en el período de SERVICIO + las de esta factura.
      if (!v.servicePeriodStart) {
        if (k.quantityCapPerPeriod) c.unknown("SERVICE_PERIOD_REQUIRED", "CORRECTION", "Falta el período de prestación: no se puede verificar el tope de horas del contrato");
      } else {
        const key = contractPeriodKey(k.billingFrequency, v.servicePeriodStart);
        const endKey = v.servicePeriodEnd ? contractPeriodKey(k.billingFrequency, v.servicePeriodEnd) : key;
        if (endKey !== key) {
          c.fail("SERVICE_PERIOD_SPANS", "CORRECTION", "El período de servicio abarca más de un período contractual; debe facturarse por período", { observedText: `${key}..${endKey}` });
        } else {
          if (k.quantityCapPerPeriod) {
            const prior = new D(k.consumedHoursInPeriod ?? "0");
            const total = prior.plus(hours);
            const detail = { observedText: `${prior.toString()} previas + ${hours.toString()} esta factura = ${total.toString()} h (${key})`, expectedText: `≤ ${k.quantityCapPerPeriod} h` };
            if (total.gt(k.quantityCapPerPeriod)) c.fail("HOURLY_CAP", "CORRECTION", "Horas acumuladas del período superan el máximo contractual", detail);
            else c.pass("HOURLY_CAP", "Horas acumuladas dentro del máximo contractual del período", detail);
          }
          if (hours.gt(0)) hold.hoursToConsume = { contractId: k.contractId, periodKey: key, hours: hours.toString() };
        }
      }
      if (input.attachments.some((a) => a.purpose === "TIMESHEET")) c.pass("HOURLY_SUPPORT", "Respaldo de horas adjunto");
      else c.unknown("HOURLY_SUPPORT", "CORRECTION", "Falta el respaldo de horas (hoja de tiempo)");
      break;
    }
    case "RECURRING": {
      if (!k.fixedPeriodAmount) {
        c.unknown("RECURRING_AMOUNT", "CORRECTION", "El contrato recurrente no define importe por período");
        break;
      }
      const amount = v.subtotal ? new D(v.subtotal) : total;
      if (!amount) break;
      if (!amount.eq(k.fixedPeriodAmount)) {
        c.fail("RECURRING_AMOUNT", "CORRECTION", "Importe distinto del pactado por período", { observedAmount: toMoney4(amount), expectedAmount: k.fixedPeriodAmount, currency: cur });
      } else c.pass("RECURRING_AMOUNT", "Importe conforme al período pactado", { observedAmount: toMoney4(amount), expectedAmount: k.fixedPeriodAmount, currency: cur });
      if (!v.servicePeriodStart) c.unknown("RECURRING_PERIOD", "CORRECTION", "Falta el período de servicio facturado");
      else if (k.reservedPeriodStarts.includes(v.servicePeriodStart)) {
        c.fail("RECURRING_PERIOD", "CORRECTION", "El período ya fue comprometido por otra factura; posible duplicado con otro número", { observedText: v.servicePeriodStart });
      } else c.pass("RECURRING_PERIOD", "Período de servicio no comprometido previamente", { observedText: v.servicePeriodStart });
      break;
    }
    case "MILESTONE": {
      const milestones = k.items.filter((i) => i.itemKind === "MILESTONE");
      if (v.lines.length === 0) {
        c.unknown("MILESTONE_LINES", "CORRECTION", "La factura no identifica el hito facturado");
        break;
      }
      for (const line of v.lines) {
        const m = milestones.find((x) => line.itemRef && norm(x.milestoneRef) === norm(line.itemRef));
        if (!m) {
          c.fail("MILESTONE_REF", "CORRECTION", `Línea ${line.lineNo}: hito no identificado en el contrato`, { observedText: line.itemRef ?? line.concept });
          continue;
        }
        if (!eqDec(line.subtotal, m.agreedAmount!)) {
          c.fail("MILESTONE_AMOUNT", "CORRECTION", `Línea ${line.lineNo}: importe distinto del pactado para el hito`, { observedAmount: line.subtotal, expectedAmount: m.agreedAmount, currency: cur });
        } else c.pass("MILESTONE_AMOUNT", `Hito ${m.milestoneRef}: importe conforme`, { observedAmount: line.subtotal, expectedAmount: m.agreedAmount, currency: cur });
        if (k.reservedMilestoneRefs.some((r) => norm(r) === norm(m.milestoneRef))) {
          c.fail("MILESTONE_ALREADY_INVOICED", "BLOCK", `Hito ${m.milestoneRef} ya comprometido por otra factura autorizada`, { observedText: m.milestoneRef });
        }
        const accepted = input.attachments.some((a) => a.purpose === "MILESTONE_ACCEPTANCE" && (a.milestoneRef === null || norm(a.milestoneRef) === norm(m.milestoneRef)));
        if (accepted) c.pass("MILESTONE_ACCEPTANCE", `Hito ${m.milestoneRef}: evidencia de aceptación adjunta`);
        else c.unknown("MILESTONE_ACCEPTANCE", "CORRECTION", `Hito ${m.milestoneRef}: falta evidencia de aceptación`, { observedText: m.milestoneRef });
      }
      break;
    }
    case "PURCHASE_ORDER": {
      const poLines = k.items.filter((i) => i.itemKind === "PO_LINE");
      if (v.lines.length === 0) {
        c.unknown("PO_LINES", "CORRECTION", "La factura no detalla líneas de la orden de compra");
        break;
      }
      for (const line of v.lines) {
        const p = poLines.find((x) => line.itemRef && norm(x.code) === norm(line.itemRef));
        if (!p) {
          c.fail("PO_ITEM", "CORRECTION", `Línea ${line.lineNo}: ítem no incluido en la orden de compra`, { observedText: line.itemRef ?? line.concept });
          continue;
        }
        if (!line.quantity || !line.unitPrice) {
          c.unknown("PO_LINE_DATA", "CORRECTION", `Línea ${line.lineNo}: falta cantidad o precio unitario`);
          continue;
        }
        if (new D(line.quantity).gt(p.agreedQuantity!)) {
          c.fail("PO_QUANTITY", "CORRECTION", `Línea ${line.lineNo}: cantidad superior a la pactada`, { observedText: line.quantity, expectedText: p.agreedQuantity });
        } else c.pass("PO_QUANTITY", `Línea ${line.lineNo}: cantidad dentro de lo pactado`, { observedText: line.quantity, expectedText: p.agreedQuantity });
        if (!eqDec(line.unitPrice, p.unitPrice!)) {
          c.fail("PO_UNIT_PRICE", "CORRECTION", `Línea ${line.lineNo}: precio unitario distinto del pactado`, { observedAmount: line.unitPrice, expectedAmount: p.unitPrice, currency: cur });
        } else c.pass("PO_UNIT_PRICE", `Línea ${line.lineNo}: precio conforme`, { observedAmount: line.unitPrice, expectedAmount: p.unitPrice, currency: cur });
      }
      break;
    }
  }
}

/**
 * Explica cada candidato contractual (para evaluation_contract_candidates):
 * coincidencia de modalidad y de referencia citada, y cuál seleccionaría el motor.
 * Usa exactamente la misma lógica determinista que `decide()`.
 */
export function explainCandidates(input: EngineInput): Array<{ contractVersionId: string; typeMatch: boolean; referenceMatch: boolean | null; selected: boolean; reason: string }> {
  const c = new CheckList();
  const selected = selectContract(input, c);
  const detected = input.detectedBillingType;
  const cited = input.version.contractRefCited;
  return input.contractCandidates.map((k) => {
    const typeMatch = !detected || detected === k.billingType;
    const referenceMatch = cited ? norm(cited) === norm(k.contractRef) : null;
    const isSelected = selected?.versionId === k.versionId;
    const reason = isSelected
      ? "Seleccionado: único contrato vigente compatible"
      : !typeMatch
        ? `Descartado: modalidad ${k.billingType} distinta de la facturada (${detected})`
        : referenceMatch === false
          ? `Descartado: la factura cita ${cited}`
          : (c.items.find((x) => x.outcome !== "PASS")?.reason ?? "No seleccionado");
    return { contractVersionId: k.versionId, typeMatch, referenceMatch, selected: isSelected, reason };
  });
}
