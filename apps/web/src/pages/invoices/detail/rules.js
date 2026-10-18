/** Etiquetas legibles de las reglas del motor (los códigos vienen del backend; la explicación concreta la da `check.reason`). */
export const RULE_LABELS = {
  EXTRACTION_QUALITY: "Calidad de la extracción",
  INVOICE_NUMBER_PRESENT: "Número de factura presente",
  ISSUE_DATE_PRESENT: "Fecha de emisión presente",
  CURRENCY_PRESENT: "Moneda presente",
  TOTAL_PRESENT: "Total presente",
  TOTAL_ARITHMETIC: "Aritmética del total",
  LINES_SUM: "Suma de líneas",
  LINE_ARITHMETIC: "Aritmética de líneas",
  ISSUER_MATCHES_VENDOR: "Emisor coincide con el proveedor",
  VENDOR_STATUS: "Estado del proveedor",
  BANK_ACCOUNT: "Cuenta de pago registrada",
  DUPLICATE_INVOICE: "Factura duplicada",
  POSSIBLE_DUPLICATE_DOCUMENT: "Documento posiblemente duplicado",
  CONTRACT_FOUND: "Contrato vigente",
  CONTRACT_AMBIGUOUS: "Contrato ambiguo",
  CONTRACT_REF_MATCH: "Referencia de contrato",
  CONTRACT_TYPE_MATCH: "Modalidad del contrato",
  CONTRACT_CURRENCY: "Moneda del contrato",
  CATEGORY_MATCH: "Categoría de gasto",
  BILLING_TYPE: "Modalidad de facturación",
  SERVICE_PERIOD_REQUIRED: "Período de servicio",
  SERVICE_PERIOD_SPANS: "Período dentro de un solo ciclo",
  HOURLY_LINES: "Líneas por horas",
  HOURLY_LINE_DATA: "Datos de líneas por horas",
  HOURLY_UNIT: "Unidad horaria",
  HOURLY_RATE: "Tarifa por hora",
  HOURLY_RATE_ITEM: "Ítem de tarifa",
  HOURLY_CAP: "Tope de horas del período",
  HOURLY_SUPPORT: "Soporte de horas",
  RECURRING_AMOUNT: "Importe recurrente",
  RECURRING_PERIOD: "Período recurrente",
  MILESTONE_REF: "Referencia de hito",
  MILESTONE_LINES: "Líneas del hito",
  MILESTONE_AMOUNT: "Importe del hito",
  MILESTONE_ACCEPTANCE: "Acta de aceptación",
  MILESTONE_ALREADY_INVOICED: "Hito ya facturado",
  PO_LINES: "Líneas de la orden",
  PO_LINE: "Línea de la orden",
  PO_LINE_DATA: "Datos de línea de orden",
  PO_ITEM: "Ítem de la orden",
  PO_QUANTITY: "Cantidad de la orden",
  PO_UNIT_PRICE: "Precio unitario de la orden",
  FX_RATE: "Tipo de cambio",
  POLICY_CONFIGURED: "Política configurada",
  HARD_INVOICE_CAP: "Tope absoluto por factura",
  AUTO_APPROVAL_LIMIT: "Límite de autorización automática",
  APPROVAL_MATRIX: "Matriz de aprobación",
  BUDGET_GLOBAL: "Presupuesto global",
  BUDGET_CATEGORY: "Presupuesto de la categoría",
  EVIDENCE_MISSING: "Evidencia documental",
  INCOMPLETE_EVALUATION: "Evaluación incompleta",
  ALL_CHECKS_PASSED: "Todas las verificaciones superadas",
  APPROVAL_REQUIRED: "Aprobación requerida",
};

export const FIELD_LABELS = {
  supplierInvoiceNumber: "Número de factura",
  issuerTaxReference: "NIT del emisor",
  issueDate: "Fecha de emisión",
  dueDate: "Vencimiento",
  servicePeriodStart: "Inicio del período de servicio",
  servicePeriodEnd: "Fin del período de servicio",
  currency: "Moneda",
  subtotal: "Subtotal",
  taxes: "Impuestos",
  discounts: "Descuentos",
  totalAmount: "Total",
  contractRefCited: "Referencia de contrato citada",
  paymentAccount: "Cuenta de pago",
};

const LINE_FIELD = { itemRef: "ítem", quantity: "cantidad", unitPrice: "precio unitario", subtotal: "subtotal", concept: "concepto", unit: "unidad" };

/** "lines[1].unitPrice" → "Línea 1 · precio unitario". */
export function fieldLabel(field) {
  const m = /^lines\[(\d+)\]\.(\w+)$/.exec(field ?? "");
  if (m) return `Línea ${m[1]} · ${LINE_FIELD[m[2]] ?? m[2]}`;
  return FIELD_LABELS[field] ?? field;
}

/** EVIDENCE_LINE_1_UNIT_PRICE → lines[1].unitPrice ; EVIDENCE_TOTAL_AMOUNT → totalAmount */
export function evidenceFieldOfRule(code) {
  if (!code?.startsWith("EVIDENCE_") || code === "EVIDENCE_MISSING") return null;
  const rest = code.slice(9);
  const camel = (s) => s.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  const m = /^LINE_(\d+)_(.+)$/.exec(rest);
  return m ? `lines[${m[1]}].${camel(m[2])}` : camel(rest);
}

export function ruleLabel(code) {
  if (RULE_LABELS[code]) return RULE_LABELS[code];
  const f = evidenceFieldOfRule(code);
  if (f) return `Evidencia · ${fieldLabel(f)}`;
  return code;
}

/** Agrupación de la investigación (orden de lectura del analista). */
export const RULE_GROUPS = [
  { id: "evidence", title: "Datos y evidencia documental", test: (c) => c.startsWith("EVIDENCE_") || ["EXTRACTION_QUALITY", "INVOICE_NUMBER_PRESENT", "ISSUE_DATE_PRESENT", "CURRENCY_PRESENT", "TOTAL_PRESENT", "TOTAL_ARITHMETIC", "LINES_SUM", "LINE_ARITHMETIC"].includes(c) },
  { id: "vendor", title: "Proveedor, cuenta y duplicados", test: (c) => ["ISSUER_MATCHES_VENDOR", "VENDOR_STATUS", "BANK_ACCOUNT", "DUPLICATE_INVOICE", "POSSIBLE_DUPLICATE_DOCUMENT"].includes(c) },
  { id: "contract", title: "Contrato y condiciones", test: (c) => /^(CONTRACT|CATEGORY|BILLING|SERVICE_PERIOD|HOURLY|RECURRING|MILESTONE|PO_)/.test(c) },
  { id: "money", title: "Tipo de cambio, política y presupuesto", test: () => true },
];

export const EFFECT_LABEL = {
  BLOCK: "Bloquea",
  CORRECTION: "Pide corrección",
  APPROVAL: "Requiere aprobación",
  ENABLEMENT: "Requiere habilitación",
  ERROR: "Error técnico",
  INFO: "Informativo",
};

export const STAGES = [
  { code: "EXTRACT_CLASSIFY", label: "Extracción y clasificación", hint: "La IA lee el documento y propone datos estructurados" },
  { code: "CONTRACT_MATCH", label: "Búsqueda de contrato", hint: "Candidatos del proveedor por modalidad y referencia" },
  { code: "CONTRACT_VALIDATE", label: "Validación y evidencia", hint: "Cada dato se coteja con el texto del original" },
  { code: "FINANCIAL_DECISION", label: "Decisión financiera", hint: "Motor determinista: política, FX y presupuesto" },
];

export const PROCESSING_LABEL = {
  queued: "En cola",
  extracting: "Extrayendo datos",
  matching: "Buscando contrato",
  validating: "Validando evidencias",
  deciding: "Decidiendo",
  finished: "Finalizado",
  failed: "Falló",
};

export const TRIGGER_LABEL = { MANUAL: "Manual", UPLOAD: "Carga", CORRECTION: "Corrección", APPROVAL_RESOLVED: "Aprobación resuelta", RETRY: "Reintento", REEVALUATION: "Reevaluación" };
