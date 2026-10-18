/**
 * Contrato HTTP PROVISIONAL (OpenAPI 3.1) para el futuro frontend React.
 * Sujeto a ajustes de UX. Validado por pruebas: cada ruta documentada existe.
 * Convenciones: importes como strings decimales; ids UUID; errores con
 * { error: { code, message, requestId, details? } }; mutaciones con cookie de
 * sesión + cabecera X-CSRF-Token + Origin permitido.
 */
type Schema = Record<string, unknown>;

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const money: Schema = { type: "string", pattern: "^\\d{1,16}(\\.\\d{1,4})?$", examples: ["1200.00"] };
const uuid: Schema = { type: "string", format: "uuid" };
const json = (schema: Schema) => ({ "application/json": { schema } });
const ok = (description: string, schema: Schema = { type: "object" }) => ({ description, content: json(schema) });
const errors = {
  "400": { description: "Validación", content: json(ref("Error")) },
  "401": { description: "Sin sesión / sesión expirada", content: json(ref("Error")) },
  "403": { description: "CSRF/origen o empresa no autorizada", content: json(ref("Error")) },
  "404": { description: "No encontrado (o de otra empresa)", content: json(ref("Error")) },
};
const idParam = (name = "id") => ({ name, in: "path", required: true, schema: uuid });
const companyHeader = { name: "X-Company-Id", in: "header", required: false, schema: uuid, description: "Selección de empresa; se valida contra la membresía." };

interface Op {
  summary: string;
  tag: string;
  params?: Schema[];
  body?: Schema;
  bodyType?: string;
  response?: [string, string, Schema?];
  public?: boolean;
}

function op(o: Op) {
  return {
    summary: o.summary,
    tags: [o.tag],
    ...(o.public ? { security: [] } : {}),
    parameters: [...(o.public ? [] : [companyHeader]), ...(o.params ?? [])],
    ...(o.body ? { requestBody: { required: true, content: { [o.bodyType ?? "application/json"]: { schema: o.body } } } } : {}),
    responses: { [o.response?.[0] ?? "200"]: ok(o.response?.[1] ?? "OK", o.response?.[2]), ...errors },
  };
}

const statusChange: Schema = { type: "object", required: ["status", "reason"], properties: { status: { enum: ["PENDING", "AUTHORIZED", "BLOCKED"] }, reason: { type: "string", minLength: 3 } } };

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Blinka PayGuard AI — API backend P0 (PROVISIONAL)",
    version: "0.1.0",
    description:
      "Autorizaciones y reservas SIMULADAS (sin pagos reales). Contrato provisional sujeto a ajustes UX. Aprobadores = personas SIMULADAS. Proveedor IA local = FAKE (MOCK) salvo configuración de Gemini.",
  },
  servers: [{ url: "http://localhost:4000" }],
  components: {
    securitySchemes: {
      session: { type: "apiKey", in: "cookie", name: "__Host-blinka_session" },
      csrf: { type: "apiKey", in: "header", name: "X-CSRF-Token" },
    },
    schemas: {
      FieldEvidence: {
        type: "object",
        description: "Verificación determinista de un valor contra el documento original",
        properties: { sourceField: { type: "string" }, verificationStatus: { enum: ["TEXT_VERIFIED", "NOT_FOUND", "UNVERIFIABLE", "HUMAN_CONFIRMED", "MODEL_REPORTED", "REJECTED"] }, pageNumber: { type: ["integer", "null"] }, charStart: { type: ["integer", "null"] }, excerpt: { type: ["string", "null"] } },
      },
      Error: { type: "object", properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" }, requestId: { type: "string" }, details: {} } } } },
      Money: money,
      VisibleOutcome: { enum: ["AUTORIZADA", "EN_APROBACION", "EN_CORRECCION", "BLOQUEADA", "RECHAZADA", "ERROR"] },
      EngineDecision: { enum: ["AUTHORIZE", "BLOCK", "ESCALATE", null] },
      Session: {
        type: "object",
        properties: { user: { type: "object", properties: { id: uuid, email: { type: "string" } } }, companies: { type: "array", items: { type: "object" } }, csrfToken: { type: "string" }, expiresAt: { type: "string", format: "date-time" } },
      },
      InvoiceData: {
        type: "object",
        properties: {
          supplierInvoiceNumber: { type: "string" },
          issuerTaxReference: { type: "string" },
          issueDate: { type: "string", format: "date" },
          dueDate: { type: "string", format: "date" },
          servicePeriodStart: { type: "string", format: "date" },
          servicePeriodEnd: { type: "string", format: "date" },
          currency: { type: "string", pattern: "^[A-Z]{3}$" },
          subtotal: money,
          taxes: money,
          discounts: money,
          totalAmount: money,
          contractRefCited: { type: "string" },
          paymentDestinationRaw: { type: "string" },
          lines: { type: "array", items: { type: "object", required: ["concept", "subtotal"], properties: { concept: { type: "string" }, itemRef: { type: "string" }, quantity: money, unit: { type: "string" }, unitPrice: money, subtotal: money, taxAmount: money } } },
        },
      },
      EvaluationSummary: {
        type: "object",
        properties: { flowId: uuid, runId: uuid, runNo: { type: "integer" }, status: { enum: ["COMPLETED", "SUPERSEDED"] }, decision: ref("EngineDecision"), visibleOutcome: ref("VisibleOutcome"), reasonCode: { type: "string" }, amountBase: money, period: { type: "string" }, reservationId: uuid },
      },
      RunProgress: {
        type: "object",
        properties: {
          runId: uuid,
          processing: { enum: ["queued", "extracting", "matching", "validating", "deciding", "finished", "failed"] },
          terminal: { type: "boolean" },
          stages: { type: "array", items: { type: "object", properties: { stage: { enum: ["EXTRACT_CLASSIFY", "CONTRACT_MATCH", "CONTRACT_VALIDATE", "FINANCIAL_DECISION"] }, attemptNo: { type: "integer" }, status: { enum: ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "REUSED"] }, reused: { type: "boolean" }, errorCode: { type: "string" } } } },
          result: { type: ["object", "null"] },
        },
      },
    },
  },
  security: [{ session: [] }],
  paths: {
    "/health": { get: op({ summary: "Liveness", tag: "Sistema", public: true }) },
    "/ready": { get: op({ summary: "Readiness (PostgreSQL)", tag: "Sistema", public: true }) },
    "/openapi.json": { get: op({ summary: "Este documento", tag: "Sistema", public: true }) },
    "/api/auth/login": {
      post: op({ summary: "Login (Argon2id, cookie de sesión, rate limit)", tag: "Auth", public: true, body: { type: "object", required: ["email", "password"], properties: { email: { type: "string" }, password: { type: "string" } } }, response: ["200", "Sesión", ref("Session")] }),
    },
    "/api/auth/logout": { post: op({ summary: "Logout (revoca la sesión)", tag: "Auth", response: ["204", "Sin contenido"] }) },
    "/api/auth/session": { get: op({ summary: "Sesión actual + token CSRF", tag: "Auth", response: ["200", "Sesión", ref("Session")] }) },
    "/api/companies/current": { get: op({ summary: "Empresa autorizada (moneda base, zona horaria)", tag: "Empresa" }) },
    "/api/dashboard": { get: op({ summary: "Agregados del panel", tag: "Empresa", params: [{ name: "period", in: "query", schema: { type: "string" } }] }) },
    "/api/categories": {
      get: op({ summary: "Categorías", tag: "Configuración" }),
      post: op({ summary: "Crear categoría", tag: "Configuración", body: { type: "object", properties: { code: { type: "string" }, name: { type: "string" } } }, response: ["201", "Creada"] }),
    },
    "/api/categories/{id}": { patch: op({ summary: "Editar categoría", tag: "Configuración", params: [idParam()], body: { type: "object" } }) },
    "/api/approval-personas": {
      get: op({ summary: "Personas aprobadoras SIMULADAS", tag: "Configuración" }),
      post: op({ summary: "Crear persona simulada", tag: "Configuración", body: { type: "object" }, response: ["201", "Creada"] }),
    },
    "/api/approval-personas/{id}": { patch: op({ summary: "Editar persona simulada", tag: "Configuración", params: [idParam()], body: { type: "object" } }) },
    "/api/vendors": {
      get: op({ summary: "Proveedores", tag: "Proveedores" }),
      post: op({ summary: "Crear proveedor (nace PENDING)", tag: "Proveedores", body: { type: "object", properties: { legalName: { type: "string" }, taxReference: { type: "string" } } }, response: ["201", "Creado"] }),
    },
    "/api/vendors/{id}": { get: op({ summary: "Proveedor + cuentas (enmascaradas)", tag: "Proveedores", params: [idParam()] }), patch: op({ summary: "Editar proveedor", tag: "Proveedores", params: [idParam()], body: { type: "object" } }) },
    "/api/vendors/{id}/status": { post: op({ summary: "Cambiar estado del proveedor (motivo obligatorio)", tag: "Proveedores", params: [idParam()], body: statusChange }) },
    "/api/vendors/{id}/bank-accounts": {
      get: op({ summary: "Cuentas del proveedor", tag: "Proveedores", params: [idParam()] }),
      post: op({ summary: "Registrar cuenta (se guarda huella HMAC + máscara)", tag: "Proveedores", params: [idParam()], body: { type: "object", properties: { country: { type: "string" }, currency: { type: "string" }, accountNumber: { type: "string" } } }, response: ["201", "Creada"] }),
    },
    "/api/vendors/{id}/bank-accounts/{accountId}/status": { post: op({ summary: "Cambiar estado de la cuenta", tag: "Proveedores", params: [idParam(), idParam("accountId")], body: statusChange }) },
    "/api/documents": {
      post: op({
        summary: "Subir documento privado (cuerpo binario; nombre en X-File-Name)",
        tag: "Documentos",
        params: [{ name: "kind", in: "query", required: true, schema: { enum: ["INVOICE", "CONTRACT", "EVIDENCE"] } }, { name: "X-File-Name", in: "header", schema: { type: "string" } }],
        body: { type: "string", format: "binary" },
        bodyType: "application/pdf",
        response: ["201", "Documento"],
      }),
    },
    "/api/documents/{id}": { get: op({ summary: "Metadatos del documento", tag: "Documentos", params: [idParam()] }) },
    "/api/documents/{id}/access": { get: op({ summary: "URL temporal tras autorización", tag: "Documentos", params: [idParam()] }) },
    "/api/documents/{id}/content": { get: op({ summary: "Descarga autenticada (attachment, CSP sandbox)", tag: "Documentos", params: [idParam()] }) },
    "/api/contracts": {
      get: op({ summary: "Contratos", tag: "Contratos", params: [{ name: "vendorId", in: "query", schema: uuid }] }),
      post: op({ summary: "Crear contrato + versión (validación por modalidad)", tag: "Contratos", body: { type: "object" }, response: ["201", "Contrato"] }),
    },
    "/api/contracts/{id}": { get: op({ summary: "Contrato con versiones e ítems", tag: "Contratos", params: [idParam()] }) },
    "/api/contracts/{id}/versions": { post: op({ summary: "Nueva versión (DRAFT o confirmada)", tag: "Contratos", params: [idParam()], body: { type: "object" }, response: ["201", "Contrato"] }) },
    "/api/contracts/{id}/versions/{versionId}/confirm": { post: op({ summary: "Confirmación humana de una versión", tag: "Contratos", params: [idParam(), idParam("versionId")] }) },
    "/api/contracts/{id}/versions/{versionId}/reject": { post: op({ summary: "Rechazar borrador", tag: "Contratos", params: [idParam(), idParam("versionId")], body: { type: "object", properties: { reason: { type: "string" } } } }) },
    "/api/invoices": {
      get: op({
        summary: "Facturas con estado comercial, filtros en servidor y total",
        tag: "Facturas",
        params: [
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "offset", in: "query", schema: { type: "integer" } },
          { name: "status", in: "query", schema: { enum: ["AUTORIZADA", "EN_APROBACION", "EN_CORRECCION", "BLOQUEADA", "RECHAZADA", "ERROR", "NOT_EVALUATED", "PROCESSING"] } },
          { name: "vendorId", in: "query", schema: uuid },
          { name: "currency", in: "query", schema: { type: "string" } },
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "from", in: "query", schema: { type: "string", format: "date" } },
          { name: "to", in: "query", schema: { type: "string", format: "date" } },
          { name: "sort", in: "query", schema: { enum: ["created_desc", "created_asc", "amount_desc", "amount_asc"] } },
        ],
        response: ["200", "Página", { type: "object", properties: { invoices: { type: "array", items: { type: "object" } }, total: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" } } }],
      }),
      post: op({ summary: "Registrar factura (proveedor obligatorio + documento INVOICE)", tag: "Facturas", body: { type: "object", required: ["vendorId", "documentId"], properties: { vendorId: uuid, documentId: uuid, categoryId: uuid, replacesInvoiceId: uuid, data: ref("InvoiceData") } }, response: ["201", "Factura"] }),
    },
    "/api/invoices/{id}": { get: op({ summary: "Factura con versiones y líneas", tag: "Facturas", params: [idParam()] }) },
    "/api/invoices/{id}/versions": { post: op({ summary: "Corrección: nueva versión inmutable", tag: "Facturas", params: [idParam()], body: { type: "object", properties: { data: ref("InvoiceData"), documentId: uuid, reason: { type: "string" } } }, response: ["201", "Factura"] }) },
    "/api/invoices/{id}/versions/{versionId}/confirmations": {
      post: op({
        summary: "Corroboración HUMANA de campos sin capa de texto (imagen/escaneo). No admite override de discrepancias en PDF con texto (409)",
        tag: "Facturas",
        params: [idParam(), idParam("versionId")],
        body: { type: "object", required: ["fields", "reason"], properties: { fields: { type: "array", items: { type: "string" } }, reason: { type: "string", minLength: 10 } } },
        response: ["201", "Confirmación registrada"],
      }),
    },
    "/api/invoices/{id}/attachments": {
      get: op({ summary: "Evidencias adjuntas", tag: "Facturas", params: [idParam()] }),
      post: op({ summary: "Adjuntar evidencia (TIMESHEET, MILESTONE_ACCEPTANCE…)", tag: "Facturas", params: [idParam()], body: { type: "object" }, response: ["201", "Adjunto"] }),
    },
    "/api/invoices/{id}/evaluations": {
      get: op({ summary: "Historial: trámites, corridas, checks, políticas, reserva", tag: "Evaluaciones", params: [idParam()] }),
      post: op({ summary: "Evaluación determinista síncrona (sin IA)", tag: "Evaluaciones", params: [idParam()], body: { type: "object" }, response: ["201", "Evaluación", { type: "object", properties: { evaluation: ref("EvaluationSummary") } }] }),
    },
    "/api/invoices/{id}/analysis": { post: op({ summary: "Encolar análisis asistido (IA + motor); responde 202", tag: "Evaluaciones", params: [idParam()], body: { type: "object" }, response: ["202", "Encolado"] }) },
    "/api/evaluation-runs/{id}": { get: op({ summary: "Progreso por polling (etapas reales)", tag: "Evaluaciones", params: [idParam()], response: ["200", "Progreso", ref("RunProgress")] }) },
    "/api/invoices/{id}/approval-requests": { get: op({ summary: "Solicitudes de aprobación de la factura", tag: "Aprobaciones", params: [idParam()] }) },
    "/api/approval-requests": { get: op({ summary: "Solicitudes (simuladas)", tag: "Aprobaciones", params: [{ name: "status", in: "query", schema: { enum: ["PENDING", "APPROVED", "REJECTED", "SUPERSEDED"] } }] }) },
    "/api/approval-requests/{id}/resolve": {
      post: op({ summary: "Resolución SIMULADA (APPROVE ⇒ reevaluación; REJECT ⇒ RECHAZADA)", tag: "Aprobaciones", params: [idParam()], body: { type: "object", required: ["decision", "reason"], properties: { decision: { enum: ["APPROVE", "REJECT"] }, reason: { type: "string" } } } }),
    },
    "/api/policies": { get: op({ summary: "Políticas", tag: "Políticas" }), post: op({ summary: "Crear política + versión tipada", tag: "Políticas", body: { type: "object" }, response: ["201", "Política"] }) },
    "/api/policies/{id}": { get: op({ summary: "Política con versiones y matriz", tag: "Políticas", params: [idParam()] }) },
    "/api/policies/{id}/versions": { post: op({ summary: "Publicar versión inmutable", tag: "Políticas", params: [idParam()], body: { type: "object" }, response: ["201", "Política"] }) },
    "/api/policies/{id}/active": { post: op({ summary: "Activar/desactivar", tag: "Políticas", params: [idParam()], body: { type: "object", properties: { active: { type: "boolean" } } } }) },
    "/api/budgets": {
      get: op({ summary: "Presupuestos del mes", tag: "Presupuestos", params: [{ name: "period", in: "query", required: true, schema: { type: "string" } }] }),
      put: op({ summary: "Fijar límite mensual (GLOBAL/CATEGORY)", tag: "Presupuestos", body: { type: "object", properties: { period: { type: "string" }, scope: { enum: ["GLOBAL", "CATEGORY"] }, categoryId: uuid, limitBase: money } } }),
    },
    "/api/system/environment": { get: op({ summary: "Servicios activos y si son reales o SIMULADOS (sin secretos)", tag: "Sistema" }) },
    "/api/budgets/reservations": { get: op({ summary: "Reservas simuladas del mes (dos asignaciones del mismo importe)", tag: "Presupuestos", params: [{ name: "period", in: "query", required: true, schema: { type: "string" } }] }) },
    "/api/evaluation-runs/{id}/evidence": { get: op({ summary: "Evidencias verificadas (página/posición) y contratos examinados de una corrida", tag: "Evaluaciones", params: [idParam()] }) },
    "/api/documents/{id}/text": { get: op({ summary: "Capa de texto del documento (para resaltar evidencias)", tag: "Documentos", params: [idParam()] }) },
    "/api/ai-usage": { get: op({ summary: "Consumo de IA por llamada (sin prompts); isSimulated = MOCK", tag: "Auditoría", params: [{ name: "evaluationRunId", in: "query", schema: uuid }] }) },
    "/api/audit-events": {
      get: op({
        summary: "Auditoría append-only",
        tag: "Auditoría",
        params: [
          { name: "entityType", in: "query", schema: { type: "string" } },
          { name: "entityRef", in: "query", schema: uuid },
          { name: "eventType", in: "query", schema: { type: "string" } },
          { name: "actorKind", in: "query", schema: { enum: ["USER", "SYSTEM", "AGENT"] } },
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "offset", in: "query", schema: { type: "integer" } },
        ],
      }),
    },
  },
} as const;
