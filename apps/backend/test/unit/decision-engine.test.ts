import { describe, expect, it } from "vitest";
import { decide, periodOf, type EngineInput } from "../../src/modules/evaluations/decision-engine.js";
import { evidenceFieldsFor, type FieldEvidence } from "../../src/modules/evidence/verifier.js";

/** Evidencia de un documento cuyo texto contiene TODOS los valores de la versión (caso conforme). */
const allVerified = (i: EngineInput): FieldEvidence[] =>
  evidenceFieldsFor({ ...i.version, servicePeriodStart: i.version.servicePeriodStart, servicePeriodEnd: i.version.servicePeriodEnd }, i.bankMatch.kind === "MATCHED" ? "CO98765432101122" : null).map((f) => ({
    ...f,
    status: "TEXT_VERIFIED",
    page: 1,
    start: 0,
    end: 1,
    excerpt: "…",
  }));

const NOW = new Date("2026-10-18T15:00:00Z");

/** Entrada base: factura por horas totalmente conforme (FIN-01). Cada prueba cambia un aspecto. */
function base(overrides: (i: EngineInput) => void = () => {}): EngineInput {
  const input: EngineInput = {
    now: NOW,
    company: { id: "co", baseCurrency: "USD", timezone: "America/Bogota" },
    invoice: { id: "inv", vendorId: "ven", categoryId: null, duplicateOfInvoiceId: null, sameContentInvoiceIds: [] },
    version: {
      id: "ver",
      supplierInvoiceNumber: "FAC-1",
      issuerTaxReference: "900123",
      issueDate: "2026-10-10",
      servicePeriodStart: "2026-10-01",
      servicePeriodEnd: "2026-10-31",
      currency: "USD",
      subtotal: "1200.00",
      taxes: "0",
      discounts: "0",
      totalAmount: "1200.00",
      contractRefCited: null,
      lines: [{ lineNo: 1, concept: "Desarrollo", itemRef: "DEV", quantity: "40", unit: "HOUR", unitPrice: "30.00", subtotal: "1200.00" }],
    },
    attachments: [{ purpose: "TIMESHEET", milestoneRef: null }],
    vendor: { id: "ven", status: "AUTHORIZED", taxReference: "900123" },
    bankMatch: { kind: "MATCHED", accountId: "acc", status: "AUTHORIZED" },
    detectedBillingType: null,
    contractCandidates: [
      {
        contractId: "ct",
        contractRef: "CT-1",
        billingType: "HOURLY",
        categoryId: "cat",
        versionId: "cv",
        currency: "USD",
        billingFrequency: "MONTHLY",
        fixedPeriodAmount: null,
        quantityCapPerPeriod: "160",
        items: [{ code: "DEV", itemKind: "HOURLY_RATE", unit: "HOUR", agreedQuantity: null, unitPrice: "30.000000", milestoneRef: null, agreedAmount: null }],
        reservedMilestoneRefs: [],
        reservedPeriodStarts: [],
        consumedHoursInPeriod: "0",
      },
    ],
    policies: [
      {
        policyId: "p",
        policyVersionId: "pv",
        scopeLevel: "COMPANY",
        categoryId: null,
        vendorId: null,
        contractId: null,
        name: "Global",
        autoApprovalLimitBase: "5000.0000",
        hardInvoiceCapBase: "20000.0000",
        matrix: [{ minAmountExclusive: "5000", maxAmountInclusive: "20000", personaId: "cfo" }],
      },
    ],
    fx: { status: "OK", snapshotId: "fx", rate: "1", provider: "IDENTITY", isSimulated: false, validUntil: new Date(NOW.getTime() + 3_600_000) },
    budgets: { period: "2026-10", global: { id: "bg", limitBase: "50000", reservedBase: "0" }, byCategory: { cat: { id: "bc", limitBase: "10000", reservedBase: "0" } } },
    approvals: [],
    supportedCurrencies: new Set(["USD", "EUR", "COP"]),
    evidence: { documentId: "doc", layerStatus: "TEXT", fields: [] },
  };
  overrides(input);
  // Salvo que la prueba fije su propia evidencia, el documento respalda todos los valores.
  if (input.evidence.fields.length === 0 && input.evidence.layerStatus === "TEXT") input.evidence.fields = allVerified(input);
  return input;
}

const check = (r: ReturnType<typeof decide>, rule: string) => r.checks.find((c) => c.ruleCode === rule && c.outcome !== "PASS");

describe("DecisionEngine (puro, sin IA)", () => {
  it("FIN-01: todo conforme → AUTHORIZE/AUTORIZADA con presupuestos del mismo mes", () => {
    const r = decide(base());
    expect(r).toMatchObject({ decision: "AUTHORIZE", visibleOutcome: "AUTORIZADA", reasonCode: "ALL_CHECKS_PASSED", amountBase: "1200.0000", period: "2026-10", effectiveCategoryId: "cat" });
    expect(r.budgetsToReserve).toEqual({ global: { id: "bg", limitBase: "50000", reservedBase: "0" }, category: { id: "bc", limitBase: "10000", reservedBase: "0" } });
    expect(r.checks.every((c) => c.outcome === "PASS")).toBe(true);
    expect(r.appliedPolicies).toEqual([{ policyVersionId: "pv", reason: "COMPANY: Global" }]);
  });

  it("es determinista: la misma entrada produce el mismo resultado", () => {
    expect(JSON.stringify(decide(base()))).toBe(JSON.stringify(decide(base())));
  });

  it("FIN-02: duplicado confirmado → BLOCK", () => {
    const r = decide(base((i) => (i.invoice.duplicateOfInvoiceId = "otra")));
    expect(r).toMatchObject({ decision: "BLOCK", visibleOutcome: "BLOQUEADA", reasonCode: "DUPLICATE_INVOICE", budgetsToReserve: null });
  });

  it("FIN-03: supera el tope absoluto → BLOCK incluso con una aprobación registrada", () => {
    const r = decide(
      base((i) => {
        i.version.totalAmount = i.version.subtotal = "25000.00";
        i.version.lines = [{ lineNo: 1, concept: "x", itemRef: "DEV", quantity: "833.3333", unit: "HOUR", unitPrice: "30.00", subtotal: "25000.00" }];
        i.approvals = [{ approvalRequestId: "ap", invoiceVersionId: "ver", amountBase: "99999", personaId: "cfo" }];
      }),
    );
    expect(r).toMatchObject({ decision: "BLOCK", visibleOutcome: "BLOQUEADA", reasonCode: "HARD_INVOICE_CAP" });
    expect(check(r, "HARD_INVOICE_CAP")).toMatchObject({ observedAmount: "25000.0000", expectedAmount: "20000.0000" });
  });

  it("FIN-04: supera el umbral automático sin superar el tope → ESCALATE/EN_APROBACION con persona de la matriz", () => {
    const r = decide(
      base((i) => {
        i.version.totalAmount = i.version.subtotal = "6000.00";
        i.version.lines = [{ lineNo: 1, concept: "x", itemRef: "DEV", quantity: "200", unit: "HOUR", unitPrice: "30.00", subtotal: "6000.00" }];
        i.contractCandidates[0]!.quantityCapPerPeriod = "300";
      }),
    );
    expect(r).toMatchObject({ decision: "ESCALATE", visibleOutcome: "EN_APROBACION", reasonCode: "APPROVAL_REQUIRED", approvalRequired: { personaId: "cfo", amountBase: "6000.0000" }, budgetsToReserve: null });
  });

  it("aprobación vigente para la misma versión e importe → autoriza; con importe mayor, no", () => {
    const big = (i: EngineInput) => {
      i.version.totalAmount = i.version.subtotal = "6000.00";
      i.version.lines = [{ lineNo: 1, concept: "x", itemRef: "DEV", quantity: "200", unit: "HOUR", unitPrice: "30.00", subtotal: "6000.00" }];
      i.contractCandidates[0]!.quantityCapPerPeriod = "300";
    };
    const ok = decide(base((i) => { big(i); i.approvals = [{ approvalRequestId: "ap", invoiceVersionId: "ver", amountBase: "6000.0000", personaId: "cfo" }]; }));
    expect(ok.visibleOutcome).toBe("AUTORIZADA");
    const stale = decide(base((i) => { big(i); i.approvals = [{ approvalRequestId: "ap", invoiceVersionId: "ver", amountBase: "5500.0000", personaId: "cfo" }]; }));
    expect(stale.visibleOutcome).toBe("EN_APROBACION");
    const otherVersion = decide(base((i) => { big(i); i.approvals = [{ approvalRequestId: "ap", invoiceVersionId: "ver-anterior", amountBase: "6000", personaId: "cfo" }]; }));
    expect(otherVersion.visibleOutcome).toBe("EN_APROBACION");
  });

  it("FIN-05/06: cuenta o proveedor BLOCKED → BLOCK", () => {
    expect(decide(base((i) => (i.bankMatch = { kind: "MATCHED", accountId: "acc", status: "BLOCKED" }))).reasonCode).toBe("BANK_ACCOUNT");
    expect(decide(base((i) => (i.bankMatch = { kind: "MATCHED", accountId: "acc", status: "BLOCKED" }))).visibleOutcome).toBe("BLOQUEADA");
    expect(decide(base((i) => (i.vendor.status = "BLOCKED")))).toMatchObject({ decision: "BLOCK", reasonCode: "VENDOR_STATUS" });
    expect(decide(base((i) => (i.bankMatch = { kind: "OTHER_VENDOR" }))).visibleOutcome).toBe("BLOQUEADA");
  });

  it("FIN-07: proveedor o cuenta PENDING → ESCALATE (habilitación); aprobar la factura NO basta", () => {
    const r = decide(base((i) => { i.vendor.status = "PENDING"; i.approvals = [{ approvalRequestId: "ap", invoiceVersionId: "ver", amountBase: "999999", personaId: "cfo" }]; }));
    expect(r).toMatchObject({ decision: "ESCALATE", visibleOutcome: "EN_APROBACION", reasonCode: "VENDOR_STATUS", approvalRequired: null });
    expect(decide(base((i) => (i.bankMatch = { kind: "MATCHED", accountId: "acc", status: "PENDING" })))).toMatchObject({ visibleOutcome: "EN_APROBACION", reasonCode: "BANK_ACCOUNT" });
    expect(decide(base((i) => (i.bankMatch = { kind: "UNREGISTERED" })))).toMatchObject({ visibleOutcome: "EN_APROBACION", reasonCode: "BANK_ACCOUNT" });
  });

  it("FIN-08: tarifa pactada 30, facturada 40 → EN_CORRECCION con diferencia numérica", () => {
    const r = decide(
      base((i) => {
        i.version.totalAmount = i.version.subtotal = "1600.00";
        i.version.lines = [{ lineNo: 1, concept: "x", itemRef: "DEV", quantity: "40", unit: "HOUR", unitPrice: "40.00", subtotal: "1600.00" }];
      }),
    );
    expect(r).toMatchObject({ decision: "ESCALATE", visibleOutcome: "EN_CORRECCION", reasonCode: "HOURLY_RATE" });
    const c = check(r, "HOURLY_RATE")!;
    expect(c).toMatchObject({ observedAmount: "40.00", expectedAmount: "30.000000" });
    expect(c.reason).toContain("10.0000");
  });

  it("FIN-09: factura por horas sin cantidad/unidad/tarifa → EN_CORRECCION sin suponer", () => {
    const r = decide(base((i) => (i.version.lines = [{ lineNo: 1, concept: "Servicios", itemRef: null, quantity: null, unit: null, unitPrice: null, subtotal: "1200.00" }])));
    expect(r).toMatchObject({ visibleOutcome: "EN_CORRECCION", reasonCode: "HOURLY_LINE_DATA" });
    expect(decide(base((i) => (i.attachments = [])))).toMatchObject({ visibleOutcome: "EN_CORRECCION", reasonCode: "HOURLY_SUPPORT" });
  });

  it("FIN-10: hito sin aceptación o modalidad distinta → EN_CORRECCION", () => {
    const milestone = (i: EngineInput) => {
      i.contractCandidates = [{ ...i.contractCandidates[0]!, billingType: "MILESTONE", quantityCapPerPeriod: null, items: [{ code: "M1", itemKind: "MILESTONE", unit: null, agreedQuantity: null, unitPrice: null, milestoneRef: "ENTREGA-1", agreedAmount: "1200.0000" }] }];
      i.version.lines = [{ lineNo: 1, concept: "Entrega 1", itemRef: "ENTREGA-1", quantity: null, unit: null, unitPrice: null, subtotal: "1200.00" }];
      i.attachments = [];
    };
    expect(decide(base(milestone))).toMatchObject({ visibleOutcome: "EN_CORRECCION", reasonCode: "MILESTONE_ACCEPTANCE" });
    expect(decide(base((i) => { milestone(i); i.attachments = [{ purpose: "MILESTONE_ACCEPTANCE", milestoneRef: "ENTREGA-1" }]; })).visibleOutcome).toBe("AUTORIZADA");
    expect(decide(base((i) => (i.detectedBillingType = "MILESTONE")))).toMatchObject({ visibleOutcome: "EN_CORRECCION", reasonCode: "CONTRACT_TYPE_MATCH" });
    expect(decide(base((i) => (i.detectedBillingType = "MIXED")))).toMatchObject({ visibleOutcome: "EN_CORRECCION", reasonCode: "BILLING_TYPE" });
    // Un hito ya comprometido por otra factura autorizada se bloquea.
    expect(decide(base((i) => { milestone(i); i.attachments = [{ purpose: "MILESTONE_ACCEPTANCE", milestoneRef: null }]; i.contractCandidates[0]!.reservedMilestoneRefs = ["ENTREGA-1"]; })).reasonCode).toBe("MILESTONE_ALREADY_INVOICED");
  });

  it("FIN-11: OC con ítem, cantidad o precio fuera del acuerdo → EN_CORRECCION", () => {
    const po = (i: EngineInput) => {
      i.contractCandidates = [{ ...i.contractCandidates[0]!, billingType: "PURCHASE_ORDER", contractRef: "OC-77", quantityCapPerPeriod: null, items: [{ code: "L1", itemKind: "PO_LINE", unit: "UN", agreedQuantity: "10.0000", unitPrice: "120.000000", milestoneRef: null, agreedAmount: null }] }];
      i.version.contractRefCited = "OC-77";
      i.attachments = [];
    };
    const line = (q: string, p: string, ref = "L1") => (i: EngineInput) => {
      po(i);
      const sub = (Number(q) * Number(p)).toFixed(2);
      i.version.subtotal = i.version.totalAmount = sub;
      i.version.lines = [{ lineNo: 1, concept: "Equipos", itemRef: ref, quantity: q, unit: "UN", unitPrice: p, subtotal: sub }];
    };
    expect(decide(base(line("10", "120.00"))).visibleOutcome).toBe("AUTORIZADA");
    expect(decide(base(line("12", "120.00"))).reasonCode).toBe("PO_QUANTITY");
    expect(decide(base(line("10", "125.00"))).reasonCode).toBe("PO_UNIT_PRICE");
    expect(decide(base(line("1", "120.00", "L9"))).reasonCode).toBe("PO_ITEM");
  });

  it("FIN-12/30: sin contrato candidato (ausente, de otro proveedor o de otra empresa) → EN_CORRECCION", () => {
    expect(decide(base((i) => (i.contractCandidates = [])))).toMatchObject({ visibleOutcome: "EN_CORRECCION", reasonCode: "CONTRACT_FOUND", selectedContract: null });
    expect(decide(base((i) => (i.version.contractRefCited = "CT-DE-OTRO")))).toMatchObject({ visibleOutcome: "EN_CORRECCION", reasonCode: "CONTRACT_REF_MATCH" });
    expect(decide(base((i) => i.contractCandidates.push({ ...i.contractCandidates[0]!, contractId: "ct2", contractRef: "CT-2", versionId: "cv2" })))).toMatchObject({ reasonCode: "CONTRACT_AMBIGUOUS" });
  });

  it("FIN-13/14: presupuesto global o de categoría insuficiente → BLOCK", () => {
    const g = decide(base((i) => (i.budgets.global = { id: "bg", limitBase: "1000", reservedBase: "0" })));
    expect(g).toMatchObject({ decision: "BLOCK", reasonCode: "BUDGET_GLOBAL" });
    const k = decide(base((i) => (i.budgets.byCategory.cat = { id: "bc", limitBase: "5000", reservedBase: "4000" })));
    expect(k).toMatchObject({ decision: "BLOCK", reasonCode: "BUDGET_CATEGORY" });
    expect(check(k, "BUDGET_CATEGORY")).toMatchObject({ observedAmount: "1200.0000", expectedAmount: "1000.0000" });
    expect(decide(base((i) => (i.budgets.global = null))).reasonCode).toBe("BUDGET_GLOBAL");
  });

  it("FIN-15: moneda ausente o desconocida → EN_CORRECCION", () => {
    expect(decide(base((i) => (i.version.currency = null)))).toMatchObject({ visibleOutcome: "EN_CORRECCION", reasonCode: "CURRENCY_PRESENT" });
    expect(decide(base((i) => (i.version.currency = "XYZ")))).toMatchObject({ visibleOutcome: "EN_CORRECCION", reasonCode: "CURRENCY_PRESENT" });
  });

  it("FIN-16: FX caído o tasa vencida → ERROR técnico, nunca autorización", () => {
    const eur = (i: EngineInput) => { i.version.currency = "EUR"; i.contractCandidates[0]!.currency = "EUR"; };
    const down = decide(base((i) => { eur(i); i.fx = { status: "UNAVAILABLE", reason: "PROVIDER_UNAVAILABLE" }; }));
    expect(down).toMatchObject({ decision: null, visibleOutcome: "ERROR", reasonCode: "FX_RATE", budgetsToReserve: null, amountBase: null });
    const stale = decide(base((i) => { eur(i); i.fx = { status: "OK", snapshotId: "fx", rate: "1.08", provider: "X", isSimulated: false, validUntil: new Date(NOW.getTime() - 1) }; }));
    expect(stale.visibleOutcome).toBe("ERROR");
    // Un bloqueo verificado prevalece sobre el error técnico.
    expect(decide(base((i) => { eur(i); i.fx = { status: "UNAVAILABLE", reason: "X" }; i.vendor.status = "BLOCKED"; })).visibleOutcome).toBe("BLOQUEADA");
  });

  it("FIN-17/18: misma moneda tasa 1; EUR y COP convertidos con decimal exacto y redondeo conservador", () => {
    expect(decide(base()).amountBase).toBe("1200.0000");
    const eur = decide(base((i) => { i.version.currency = "EUR"; i.contractCandidates[0]!.currency = "EUR"; i.fx = { status: "OK", snapshotId: "fx-eur", rate: "1.0850", provider: "FIXTURE", isSimulated: true, validUntil: new Date(NOW.getTime() + 1e6) }; }));
    expect(eur).toMatchObject({ amountBase: "1302.0000", fxSnapshotId: "fx-eur", visibleOutcome: "AUTORIZADA" });
    const cop = decide(
      base((i) => {
        i.version.currency = "COP";
        i.version.subtotal = i.version.totalAmount = "4999999.99";
        i.version.lines = [{ lineNo: 1, concept: "x", itemRef: "DEV", quantity: "40", unit: "HOUR", unitPrice: "124999.99975", subtotal: "4999999.99" }];
        i.contractCandidates[0]!.currency = "COP";
        i.contractCandidates[0]!.items[0]!.unitPrice = "124999.99975";
        i.fx = { status: "OK", snapshotId: "fx-cop", rate: "0.00024", provider: "FIXTURE", isSimulated: true, validUntil: new Date(NOW.getTime() + 1e6) };
      }),
    );
    // 4999999.99 × 0.00024 = 1199.9999976 → hacia arriba a 4 decimales: 1200.0000.
    expect(cop.amountBase).toBe("1200.0000");
  });

  it("FIN-19/20: el mes presupuestario es el de la autorización en la zona horaria de la empresa", () => {
    // 2026-11-01T04:59Z es 31-oct 23:59 en Bogotá (UTC-5) → octubre.
    expect(periodOf(new Date("2026-11-01T04:59:00Z"), "America/Bogota")).toBe("2026-10");
    expect(periodOf(new Date("2026-11-01T05:00:00Z"), "America/Bogota")).toBe("2026-11");
    expect(periodOf(new Date("2026-10-31T23:30:00Z"), "Europe/Madrid")).toBe("2026-11");
    // Factura de septiembre autorizada en noviembre → presupuestos de noviembre (ambos).
    const r = decide(base((i) => { i.now = new Date("2026-11-01T05:00:00Z"); i.budgets.period = "2026-11"; i.version.issueDate = "2026-09-20"; }));
    expect(r.period).toBe("2026-11");
  });

  it("categoría de factura distinta de la del contrato → EN_CORRECCION", () => {
    expect(decide(base((i) => (i.invoice.categoryId = "otra-cat")))).toMatchObject({ visibleOutcome: "EN_CORRECCION", reasonCode: "CATEGORY_MATCH" });
  });

  it("política específica más estricta domina; hueco de matriz o sin política empresarial no se autoriza", () => {
    const vendorPolicy = { policyId: "pv2", policyVersionId: "pv-vendor", scopeLevel: "VENDOR" as const, categoryId: null, vendorId: "ven", contractId: null, name: "Proveedor", autoApprovalLimitBase: "1000", hardInvoiceCapBase: null, matrix: [] };
    const strict = decide(
      base((i) => {
        i.policies[0]!.matrix = [{ minAmountExclusive: "0", maxAmountInclusive: "5000", personaId: "jefe" }, { minAmountExclusive: "5000", maxAmountInclusive: "20000", personaId: "cfo" }];
        i.policies.push(vendorPolicy);
      }),
    );
    expect(strict).toMatchObject({ visibleOutcome: "EN_APROBACION", reasonCode: "APPROVAL_REQUIRED", approvalRequired: { personaId: "jefe", amountBase: "1200.0000" } });
    expect(strict.appliedPolicies).toHaveLength(2);
    // Umbral más estricto sin responsable en la matriz para ese rango: no se supone un aprobador.
    expect(decide(base((i) => i.policies.push(vendorPolicy)))).toMatchObject({ visibleOutcome: "EN_CORRECCION", reasonCode: "APPROVAL_MATRIX" });
    // Una política de otro proveedor no se aplica.
    expect(decide(base((i) => i.policies.push({ ...vendorPolicy, vendorId: "otro", autoApprovalLimitBase: "1" }))).visibleOutcome).toBe("AUTORIZADA");
    expect(decide(base((i) => (i.policies = [])))).toMatchObject({ visibleOutcome: "EN_CORRECCION", reasonCode: "POLICY_CONFIGURED" });
  });

  it("dos políticas de empresa con responsables distintos para el mismo importe → no se elige: EN_CORRECCION", () => {
    const r = decide(
      base((i) => {
        i.policies[0]!.autoApprovalLimitBase = "1000";
        i.policies[0]!.matrix = [{ minAmountExclusive: "1000", maxAmountInclusive: "20000", personaId: "cfo" }];
        i.policies.push({ ...i.policies[0]!, policyId: "p2", policyVersionId: "pv2", name: "Global 2", matrix: [{ minAmountExclusive: "0", maxAmountInclusive: "5000", personaId: "ceo" }] });
      }),
    );
    expect(r).toMatchObject({ visibleOutcome: "EN_CORRECCION", reasonCode: "APPROVAL_MATRIX" });
  });

  it("tope ACUMULADO de horas: previas autorizadas + actuales frente al máximo del período de servicio", () => {
    const capped = (prior: string) => base((i) => (i.contractCandidates[0]!.consumedHoursInPeriod = prior));
    const ok = decide(capped("120"));
    expect(ok).toMatchObject({ visibleOutcome: "AUTORIZADA", hoursToConsume: { contractId: "ct", periodKey: "2026-10", hours: "40" } });
    expect(ok.checks.find((c) => c.ruleCode === "HOURLY_CAP")).toMatchObject({ outcome: "PASS", observedText: expect.stringContaining("120 previas + 40") as unknown });
    const over = decide(capped("121"));
    expect(over).toMatchObject({ visibleOutcome: "EN_CORRECCION", reasonCode: "HOURLY_CAP", hoursToConsume: null });
    // Sin período de servicio no se puede imputar el tope; un período que cruza meses tampoco.
    expect(decide(base((i) => { i.version.servicePeriodStart = null; i.version.servicePeriodEnd = null; }))).toMatchObject({ reasonCode: "SERVICE_PERIOD_REQUIRED" });
    expect(decide(base((i) => (i.version.servicePeriodEnd = "2026-11-03")))).toMatchObject({ reasonCode: "SERVICE_PERIOD_SPANS" });
  });

  it("el período contractual se toma del SERVICIO, no del mes de autorización", () => {
    // Servicio de septiembre autorizado en octubre: horas al bucket 2026-09, presupuesto a 2026-10.
    const r = decide(base((i) => { i.version.servicePeriodStart = "2026-09-01"; i.version.servicePeriodEnd = "2026-09-30"; }));
    expect(r).toMatchObject({ period: "2026-10", hoursToConsume: { periodKey: "2026-09" } });
    expect(decide(base((i) => { i.contractCandidates[0]!.billingFrequency = "QUARTERLY"; i.version.servicePeriodStart = "2026-08-01"; i.version.servicePeriodEnd = "2026-09-30"; })).hoursToConsume).toMatchObject({ periodKey: "2026-Q3" });
  });

  it("evidencia: un valor ausente del documento (inventado) → EN_CORRECCION, nunca autorización", () => {
    const r = decide(base((i) => { i.evidence.fields = allVerified(i).map((e) => (e.field === "totalAmount" ? { ...e, status: "NOT_FOUND", page: null, excerpt: null } : e)); }));
    expect(r).toMatchObject({ decision: "ESCALATE", visibleOutcome: "EN_CORRECCION", reasonCode: "EVIDENCE_TOTAL_AMOUNT", budgetsToReserve: null });
    expect(r.checks.find((c) => c.ruleCode === "EVIDENCE_TOTAL_AMOUNT")).toMatchObject({ outcome: "FAIL", effect: "CORRECTION" });
    const ref = decide(base((i) => { i.version.contractRefCited = "CT-1"; i.evidence.fields = allVerified(i).map((e) => (e.field === "contractRefCited" ? { ...e, status: "NOT_FOUND" } : e)); }));
    expect(ref.reasonCode).toBe("EVIDENCE_CONTRACT_REF_CITED");
  });

  it("evidencia: documento sin texto → corroboración humana pendiente; confirmado → puede autorizar", () => {
    const unverifiable = decide(base((i) => { i.evidence.layerStatus = "NO_TEXT"; i.evidence.fields = allVerified(i).map((e) => ({ ...e, status: "UNVERIFIABLE", page: null, excerpt: null })); }));
    expect(unverifiable).toMatchObject({ visibleOutcome: "EN_CORRECCION", reasonCode: "EVIDENCE_SUPPLIER_INVOICE_NUMBER" });
    const confirmed = decide(base((i) => { i.evidence.layerStatus = "NO_TEXT"; i.evidence.fields = allVerified(i).map((e) => ({ ...e, status: "HUMAN_CONFIRMED", page: null, excerpt: null })); }));
    expect(confirmed.visibleOutcome).toBe("AUTORIZADA");
  });

  it("evidencia: sin entrada para un campo crítico → no autoriza (defensa en profundidad)", () => {
    const r = decide(base((i) => { i.evidence.fields = allVerified(i).filter((e) => e.field !== "paymentAccount"); }));
    expect(r).toMatchObject({ visibleOutcome: "EN_CORRECCION", reasonCode: "EVIDENCE_MISSING" });
  });

  it("precedencia: BLOCK > ERROR > EN_CORRECCION > EN_APROBACION, y se registran todos los checks", () => {
    const r = decide(base((i) => { i.vendor.status = "PENDING"; i.version.currency = null; i.invoice.duplicateOfInvoiceId = "d"; }));
    expect(r.visibleOutcome).toBe("BLOQUEADA");
    const failing = r.checks.filter((c) => c.outcome !== "PASS").map((c) => c.ruleCode);
    expect(failing).toEqual(expect.arrayContaining(["DUPLICATE_INVOICE", "VENDOR_STATUS", "CURRENCY_PRESENT"]));
    expect(decide(base((i) => { i.vendor.status = "PENDING"; i.version.currency = null; })).visibleOutcome).toBe("EN_CORRECCION");
  });

  it("emisor del documento distinto del proveedor seleccionado → EN_CORRECCION", () => {
    expect(decide(base((i) => (i.version.issuerTaxReference = "800999")))).toMatchObject({ visibleOutcome: "EN_CORRECCION", reasonCode: "ISSUER_MATCHES_VENDOR" });
  });

  it("importes que no cuadran o mismo archivo en otra factura → EN_CORRECCION", () => {
    expect(decide(base((i) => (i.version.taxes = "10")))).toMatchObject({ reasonCode: "TOTAL_ARITHMETIC" });
    expect(decide(base((i) => (i.invoice.sameContentInvoiceIds = ["x"])))).toMatchObject({ visibleOutcome: "EN_CORRECCION", reasonCode: "POSSIBLE_DUPLICATE_DOCUMENT" });
  });
});
