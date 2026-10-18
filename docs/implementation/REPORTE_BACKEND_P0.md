# Blinka PayGuard AI — Informe del backend MVP P0

**Fecha:** 18-10-2026 · **Repositorio:** local (`git init` autorizado; **sin commits, push ni despliegues**) ·
**Bases de datos tocadas:** solo PostgreSQL 17 local en Docker (`127.0.0.1:54329`, `blinka_dev` y `blinka_test`).
**Ninguna** operación contra Supabase, Railway ni otra base remota.

> **Actualización P0-HARDENING (18-10-2026):** ver [`REPORTE_P0_HARDENING.md`](REPORTE_P0_HARDENING.md).
> **Corrección:** la afirmación de este informe de que «Frankfurter no cubre COP» era incorrecta: valía para la API **v1**
> que usaba la implementación. Con peticiones GET reales se verificó que **Frankfurter v2 cubre USD/COP, COP/USD y
> EUR/USD**; el backend se migró a v2. Las cifras de pruebas actuales son 234 (+3 externas), no 199.

## Etiqueta de madurez

**`LOCAL_MVP_READY` + `EXTERNAL_INTEGRATION_UNVERIFIED`**

- El backend P0 funciona de extremo a extremo **en local**: API → cola Graphile → LangGraph → DecisionEngine → PostgreSQL. Lo ejecutan 199 pruebas automatizadas (0 fallos) y una demo real en Docker Compose.
- La IA local es **FAKE (MOCK)** y las tasas FX son **FIXTURE simuladas**, ambas rotuladas en BD y logs.
- Gemini, Frankfurter y Supabase Storage tienen adaptador implementado y probado con `fetch` simulado, pero **nunca se probaron contra el servicio real**. COP no tiene proveedor real (Frankfurter/BCE no lo publica): **`BLOCKED_EXTERNAL`**.
- Ninguna integración externa se declara verificada.

## 1. Estado por paquete

| Paquete | Estado | Resumen |
|---|---|---|
| B0 Fundación | **DONE** | Monorepo npm workspaces, Express 5/TS, Drizzle, Graphile, Compose. Ajustes posteriores: SSL `verify-full`, separación aprovisionamiento/ejecución, techo de reintentos. |
| B1 Identidad y aislamiento | **DONE** | Argon2id (`node:crypto`), sesiones en PostgreSQL, CSRF por capas, rate limit en PostgreSQL, contexto de empresa por membresía, seed local idempotente. |
| B2 Comercial y documentos | **DONE** | Proveedores y cuentas (huella HMAC), documentos privados (local; Supabase sin verificar), contratos por modalidad, facturas versionadas con identidad y duplicados. |
| B3 Motor financiero | **DONE** | `decide()` puro; FX con snapshots; presupuestos mensuales en la zona horaria de la empresa; reserva atómica (1 reserva + 2 asignaciones) con bloqueos e idempotencia. |
| B4 Agentes y cola | **DONE · IA real `BLOCKED_EXTERNAL`** | LangGraph.js en el worker, harness con allowlist de solo lectura, etapas persistidas con reutilización por huella, API 202 + polling. Probado con FAKE (MOCK). |
| B5 Human-in-the-loop | **DONE** | `approval_requests` simuladas. Aprobar provoca una reevaluación; rechazar da `RECHAZADA` (≠ `BLOQUEADA`); sin override en correcciones; auditoría consultable. |
| B6 Integración y entrega | **DONE (local) · despliegue `NOT_EXECUTED`** | Dashboard, OpenAPI provisional validado, demo A–M, E2E, prueba de secretos en logs, Compose verificado, archivos de Railway y CI (no ejecutados), runbook. |

Registro cronológico: [`execution-log.md`](execution-log.md) · decisiones D-001 a D-040: [`DECISIONS.md`](DECISIONS.md) · estado: [`STATUS.md`](STATUS.md).

## 2. Archivos y migraciones principales

| Fase | Migraciones (`apps/backend/drizzle/`) | Código principal (`apps/backend/src/`) |
|---|---|---|
| B1 | `0000_identity` · `0001_companies_timezone_check` (trigger de zona IANA) · `0002_rate_limit_buckets` · `0003_fix_session_revocation_check` | `modules/identity/*`, `shared/http/pg-rate-limit-store.ts`, `shared/db/{provisioning,ops-audit,seed,seed-guard}.ts` |
| B2 | `0004_commercial_domain` · `0005_commercial_integrity` (FK de versión actual, `EXCLUDE` de vigencias, triggers de inmutabilidad) | `modules/{audit,company-config,vendors,documents,contracts,invoices}/*`, `shared/money.ts`, `shared/errors/pg-error.ts` |
| B3 | `0006_financial_engine` · `0007_financial_integrity` (`EXCLUDE` de matriz, triggers diferidos de 2 asignaciones y AUTHORIZE⇒reserva, moneda base bloqueada) | `modules/evaluations/{decision-engine,evaluation-context,evaluation.service}.ts`, `modules/{policies,fx,budgets}/*` |
| B4 | `0008_agents_processing` · `0009_agents_integrity` · `0010_run_version_while_running` | `agents/{pipeline,harness}.ts`, `agents/ai/{gemini,fake}.provider.ts`, `agents/specialists/extractor.ts`, `jobs/*`, `modules/evaluations/analysis.routes.ts` |
| B5 | `0011_approvals` · `0012_approvals_integrity` | `modules/approvals/*`, `modules/audit/audit.routes.ts` |
| B6 | — | `openapi.ts`, `modules/dashboard/*`, `modules/demo/demo.seed.ts`, `scripts/{demo-run,export-openapi}.ts`, `deploy/railway/*.json`, `.github/workflows/backend-ci.yml`, `docs/api/openapi.json` |

Las **31 entidades del ER v1.2** están implementadas. Adiciones físicas documentadas:
- **Tablas nuevas:** `auth_sessions`, `rate_limit_buckets` e `invoice_attachments`.
- **Columnas `company_id`** en `contract_versions` e `invoice_versions`, para las FKs compuestas.
- **`invoices.duplicate_of_invoice_id`.**
- **`approval_requests`:** `invoice_version_id`, `amount_base` y estado `SUPERSEDED`.
- **`agent_stage_runs`:** `result_ref` y `error_retryable`.

## 3. Endpoints (contrato provisional)

Son 42 rutas y 53 operaciones, en `docs/api/openapi.json` y `GET /openapi.json`. Una prueba verifica que todas existen.

| Grupo | Endpoints |
|---|---|
| Sistema | `GET /health`, `GET /ready`, `GET /openapi.json` |
| Auth | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session` |
| Empresa | `GET /api/companies/current`, `GET /api/dashboard` |
| Configuración | `GET/POST /api/categories`, `PATCH /api/categories/:id`, `GET/POST /api/approval-personas`, `PATCH …/:id` |
| Proveedores | `GET/POST /api/vendors`, `GET/PATCH /api/vendors/:id`, `POST …/:id/status`, `GET/POST …/:id/bank-accounts`, `POST …/bank-accounts/:accountId/status` |
| Documentos | `POST /api/documents?kind=`, `GET …/:id`, `GET …/:id/access`, `GET …/:id/content` |
| Contratos | `GET/POST /api/contracts`, `GET …/:id`, `POST …/:id/versions`, `POST …/versions/:vid/confirm`, `…/reject` |
| Facturas | `GET/POST /api/invoices`, `GET …/:id`, `POST …/:id/versions`, `GET/POST …/:id/attachments` |
| Evaluación | `POST/GET /api/invoices/:id/evaluations` (síncrona, sin IA), `POST /api/invoices/:id/analysis` (202), `GET /api/evaluation-runs/:id` (polling) |
| Aprobaciones | `GET /api/approval-requests`, `POST …/:id/resolve`, `GET /api/invoices/:id/approval-requests` |
| Políticas y presupuestos | `GET/POST /api/policies`, `GET …/:id`, `POST …/:id/versions`, `POST …/:id/active`, `GET/PUT /api/budgets` |
| Auditoría | `GET /api/audit-events` |

Payloads representativos:

```jsonc
// POST /api/auth/login → 200 (+ Set-Cookie: __Host-blinka_session=…; HttpOnly; Secure; SameSite=Strict; Path=/)
{ "user": { "id": "…", "email": "evaluador@demo.blinka.local" }, "companies": [{ "id": "…", "baseCurrency": "USD", "timezone": "America/Bogota" }],
  "csrfToken": "…43 chars…", "expiresAt": "2026-10-18T19:00:00.000Z" }

// POST /api/invoices  (cabeceras: Cookie, Origin, X-CSRF-Token)
{ "vendorId": "…", "documentId": "…", "data": { "supplierInvoiceNumber": "FAC-001", "currency": "USD", "totalAmount": "1200.00",
  "lines": [{ "concept": "Desarrollo", "itemRef": "DEV", "quantity": "40", "unit": "HOUR", "unitPrice": "30.00", "subtotal": "1200.00" }] } }

// POST /api/invoices/:id/analysis → 202
{ "runId": "…", "flowId": "…", "runNo": 1, "processing": "queued", "pollUrl": "/api/evaluation-runs/…" }

// GET /api/evaluation-runs/:id (terminado)
{ "processing": "finished", "terminal": true,
  "stages": [{ "stage": "EXTRACT_CLASSIFY", "attemptNo": 1, "status": "SUCCEEDED", "reused": false }, "…"],
  "result": { "status": "COMPLETED", "decision": "AUTHORIZE", "visibleOutcome": "AUTORIZADA", "reasonCode": "ALL_CHECKS_PASSED", "amountBase": "1200.0000", "baseCurrency": "USD" } }

// Error estándar
{ "error": { "code": "CSRF_TOKEN_INVALID", "message": "Token CSRF ausente o inválido", "requestId": "…" } }
```

## 4. Arquitectura y flujo de una factura

```
                    ┌──────────────────────── apps/backend (un solo código, una imagen) ────────────────────────┐
 navegador ──HTTP──▶│ api: Express ─ sesión → CSRF → contexto empresa → módulos (Controllers/Services/Repos)     │
 (React futuro,     │        │ POST /analysis: openRun + enqueue(analysis_run, jobKey) → 202                     │
  polling)          │        ▼                                                                                   │
                    │   PostgreSQL ◀── graphile_worker.jobs (LISTEN/NOTIFY) ──▶ worker: Graphile Worker            │
                    │        ▲                                                   │                                │
                    │        │                                    LangGraph StateGraph                           │
                    │        │      EXTRACT_CLASSIFY ─▶ CONTRACT_MATCH ─▶ CONTRACT_VALIDATE ─▶ FINANCIAL_DECISION │
                    │        │      (harness + IA,      (SQL determinista)  (decide() dry-run)   (FX → tx con locks │
                    │        │       herramientas solo                                          factura→global→   │
                    │        │       lectura)                                                   categoría; decide │
                    │        └────── agent_stage_runs · ai_usage_logs · checks · reserva + 2 allocations · audit ┘
                    └────────────────────────────────────────────────────────────────────────────────────────────┘
```

Estados técnicos: `queued → extracting → matching → validating → deciding → finished | failed`. Estados comerciales, que se derivan de la última corrida: `AUTORIZADA`, `EN_APROBACION`, `EN_CORRECCION`, `BLOQUEADA`, `RECHAZADA` y `ERROR`. Precedencia: `BLOCK > ERROR > EN_CORRECCION > EN_APROBACION > AUTORIZADA`.

## 5. Pruebas: comandos y resultados medidos

Comandos, ejecutados desde la raíz con `node_modules` borrado previamente (evidencia en [`evidence/final-verification.txt`](evidence/final-verification.txt)):

```bash
npm ci && npm run lint && npm run typecheck && npm run build
npm run db:migrate:test && npm test
npm audit --omit=dev
```

Resultados:
- `lint`, `typecheck` y `build`: OK.
- **`npm test`: 24 archivos, 199/199 pruebas superadas, 0 fallidas, 52 s.**
- `npm audit --omit=dev`: **0 vulnerabilidades**.
- `npm audit` total: 4 moderadas, **solo en desarrollo** (`drizzle-kit` → `esbuild` 0.18, servidor de desarrollo no usado).

| Archivo | Pruebas | Cubre |
|---|---|---|
| unit/decision-engine | 24 | FIN-01..20, precedencia, políticas, matriz, determinismo |
| integration/commercial | 24 | B2: FKs compuestas, inmutabilidad, documentos, contratos, duplicados, aislamiento |
| integration/auth | 20 | login, hash, cookies, regeneración, expiración, CSRF, rate limit, trust proxy |
| integration/financial | 16 | FIN-01..04, 13..24, 29, 30 en BD real; carreras, reentrega, rollback, triggers |
| unit/app · unit/harness | 11 · 11 | health/errores; AG-01/05/06/11, límites, Gemini con `fetch` simulado |
| integration/approvals | 10 | FIN-25/26, doble clic, cambios entre solicitud y aprobación, sin override |
| integration/analysis | 8 | E2E Graphile real + AG-01/02/03/07/08/10/11/12 |
| unit/env-security · env · db-target · password | 8 · 7 · 7 · 6 | TLS, trust proxy, guardias, vector oficial Argon2id RFC 9106 |
| integration/company-context · identity-schema | 7 · 6 | aislamiento entre 2+ empresas, restricciones e índices |
| unit/documents · fx · enqueue · jobs-limits | 6 · 4 · 3 · 3 | magic bytes, traversal, Supabase simulado, Frankfurter simulado, techo de reintentos |
| integration/database · processes · provisioning · worker | 5 · 4 · 3 · 2 | B0 + auditoría de aprovisionamiento |
| integration/contract-and-secrets · demo-e2e | 3 · 1 | OpenAPI ↔ rutas, secretos en logs, demo A–M |

**Docker Compose** (evidencia en [`evidence/demo-compose-run.txt`](evidence/demo-compose-run.txt)):
- `docker:up` construye la imagen; `migrate` termina con exit 0 y la API y el worker quedan *healthy*.
- Flujo de autenticación verificado en contenedor: login, cookie `__Host-`, CSRF y logout.
- La demo A–M la procesó el **worker en su contenedor**: 13 pipelines, unos 260 ms por factura.
- Logs de contenedores: 0 apariciones de contraseña, secreto HMAC, hashes o números de cuenta.

**Lo que NO se probó** (no se afirma que funcione):
- Gemini real, Supabase Storage real y Frankfurter real.
- Despliegue en Railway y ejecución del workflow de CI en GitHub.
- TLS `verify-full` contra Supabase.
- Rol de BD sin DDL en remoto.
- Carga y rendimiento.
- Extracción real de PDFs, porque no hay parser y la evidencia del modelo queda como `MODEL_REPORTED`.
- Frontend, que no se desarrolló.

## 6. Comprobación de seguridad

| Área | Control | Evidencia |
|---|---|---|
| Multiempresa | Empresa por membresía; `X-Company-Id` solo selecciona y se valida; ajeno e inexistente son indistinguibles; FKs compuestas `(company_id, id)` | company-context, commercial, financial FIN-30, AG-10 |
| Autenticación | Argon2id (m=19 MiB, t=2, p=1); error y coste iguales para usuario inexistente/inactivo/contraseña mala; rehash | auth, password (RFC 9106) |
| Cookies y sesión | `__Host-`, HttpOnly, Secure, SameSite=Strict; SHA-256 del token en BD; regeneración (anti fixation); TTL 12 h + inactividad 120 min; revocación | auth, Compose |
| CSRF | Origin/Sec-Fetch-Site + tipos de cuerpo no simples + token sincronizador por sesión | auth |
| Rate limit | Login por IP y por cuenta, análisis por empresa: contadores en PostgreSQL compartidos entre instancias; `TRUST_PROXY` nunca `true` | auth (2 instancias), analysis |
| Secretos | Solo servidor; redacción pino; serializador sin parámetros SQL (hallazgo: `DrizzleQueryError`); clave Gemini solo en cabecera | contract-and-secrets, harness, Compose |
| Documentos | Magic bytes = tipo declarado; vacío/tamaño/traversal; claves generadas por el backend; 0600; descarga autenticada como adjunto con CSP sandbox; sin URLs públicas | documents, commercial |
| Dinero | NUMERIC + decimal.js; importes como strings; reserva redondeada hacia arriba; CHECK `reserved ≤ limit` | decision-engine, financial |
| Idempotencia y concurrencia | Bloqueos factura → global → categoría; `UNIQUE(invoice_id)`; clave de idempotencia; corrida concurrente `SUPERSEDED`; `jobKey` por corrida | FIN-21/21b/22/23 |
| IA | Sin herramientas de escritura; contexto confiable; argumentos Zod; límites; campos inyectados descartados; decisión siempre determinista | harness, AG-01/05/06/12 |
| DDL remoto | Migraciones y worker exigen `REMOTE_DB_CONFIRM=<host>/<db>`; seeds nunca remotos; registro JSONL/stdout de intento, resultado y rechazo | provisioning, processes |

## 7. Evidencia de los escenarios A → M (ejecución local real)

La demo con API y worker en contenedores, Graphile real, IA FAKE (MOCK) y FX FIXTURE produjo:

| Esc. | Situación | Resultado obtenido | Base USD |
|---|---|---|---|
| A | Factura válida por horas | **AUTORIZADA** · ALL_CHECKS_PASSED (1 reserva, 2 asignaciones) | 1200.0000 |
| B | Supera el tope absoluto | **BLOQUEADA** · HARD_INVOICE_CAP | 25000.0000 |
| C | Supera el umbral automático | **EN_APROBACION** · APPROVAL_REQUIRED → aprobación simulada → reevaluación **AUTORIZADA** (en la prueba E2E) | 6000.0000 |
| D | Duplicado de A | **BLOQUEADA** · DUPLICATE_INVOICE | 1200.0000 |
| E | Proveedor bloqueado | **BLOQUEADA** · VENDOR_STATUS | 300.0000 |
| F | Proveedor pendiente | **EN_APROBACION** · VENDOR_STATUS (sin solicitud de importe) | 300.0000 |
| G | Tarifa 40 vs 30 + instrucción hostil en el documento | **EN_CORRECCION** · HOURLY_RATE | 1600.0000 |
| H | Sin contrato | **EN_CORRECCION** · CONTRACT_FOUND | 300.0000 |
| I | Presupuesto de categoría insuficiente | **BLOQUEADA** · BUDGET_CATEGORY | 1200.0000 |
| J | EUR (fixture simulada) | **AUTORIZADA** | 1085.0000 |
| K | COP (fixture simulada) | **AUTORIZADA** | 960.0000 |
| L | GBP sin tasa | **ERROR** · FX_RATE (técnico, recuperable) | — |
| M | Documento ilegible | **EN_CORRECCION** · EXTRACTION_QUALITY | — |

**Reintentos:**
- AG-02: un fallo FX tras la extracción reintenta solo esa etapa. La extracción queda `REUSED` y la IA se llama **una** vez.
- AG-08: con la IA caída tres veces, la corrida termina en `ERROR · PIPELINE_UNAVAILABLE`; el reintento manual en el mismo trámite autoriza.

**Resultado:** cero autorizaciones indebidas en los escenarios probados. Solo A, J y K (y C tras la aprobación) tienen reserva. No se reclama una garantía universal.

## 8. Decisiones, desviaciones, deuda y riesgos

**Decisiones y desviaciones** (detalle en [`DECISIONS.md`](DECISIONS.md)): monorepo; Argon2id nativo; sesiones y rate limit en PostgreSQL; FKs compuestas y adiciones al ER (§2); duplicado como enlace sin identidad; motor puro con transacción bloqueante; precedencia BLOCK > ERROR; ENABLEMENT ≠ aprobación; un solo especialista LLM; la decisión financiera nunca se reutiliza; IA y FX simuladas rotuladas; aprobación ligada a versión e importe.

**Deuda técnica priorizada:**
1. Proveedor FX real para **COP**; validar Frankfurter EUR→USD real.
2. Probar Gemini real: prompt, `responseJsonSchema`, *function calling* combinado con JSON y extracción de PDF; calibrar costes.
3. Verificar la evidencia contra el texto del documento (parser de PDF o extracción literal); hoy es `MODEL_REPORTED`.
4. Tope de horas **acumulado por período** (hoy se aplica por factura) y control de períodos recurrentes por contrato.
5. Esquemas OpenAPI detallados para todos los cuerpos (varios son `object` genérico) y generación de tipos para el frontend.
6. Recuperación automática de corridas atascadas: hoy solo ante un reintento manual (`STALE_RUN`); no hay cron.
7. Matriz de aprobación solo de nivel empresa; las políticas específicas endurecen límites, pero no definen responsables.
8. Limpieza de sesiones expiradas y de contadores de rate limit, que hoy solo crecen.
9. Imagen de 407 MB: `typescript` entra como *peer* de `cosmiconfig`; se podría usar una base `alpine`.

**Riesgos para la hackatón:**
- Sin credenciales, la demo depende de mocks rotulados; el jurado debe ver la etiqueta FAKE/FIXTURE (está en BD, API y dashboard).
- Cookies entre subdominios de `*.up.railway.app`: con `SameSite=Strict` no viajan entre sitios distintos. Conviene servir el frontend en el mismo origen (proxy `/api`) o en un dominio propio.
- El pooler transaccional de Supabase rompe `LISTEN/NOTIFY` del worker: usar conexión de sesión (5432).
- Primera migración remota: requiere autorización, rol propietario y extensión `btree_gist` (disponible en Supabase; no verificado).

## 9. Qué necesito para las pruebas reales (sin activar nada antes de tu autorización)

| Integración | Necesario | Prueba propuesta |
|---|---|---|
| Gemini | `GEMINI_API_KEY` (cuenta con facturación/cuota), modelo elegido, autorización de gasto | 3–5 facturas ficticias reales en PDF: medir tokens, coste y calidad; `AI_PROVIDER=gemini` |
| Supabase PostgreSQL | Proyecto, CA raíz, roles (propietario para migrar y de ejecución sin DDL), autorización explícita por destino | `db:migrate` con `MIGRATION_DATABASE_URL` + `REMOTE_DB_CONFIRM`; arrancar el worker por conexión de sesión |
| Supabase Storage | Bucket **privado**, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (solo servidor) | Subir, descargar y firmar URL con `STORAGE_DRIVER=supabase` |
| FX | Decidir proveedor para COP (Frankfurter no lo cubre) y su política de frescura | EUR→USD con Frankfurter real; COP con el proveedor elegido |
| Railway | Proyecto, dos servicios (api y worker) con `deploy/railway/*.json`, variables (RUNBOOK §6), dominio | Desplegar tras revisar; `/ready` y demo |
| GitHub | Repositorio remoto y autorización de commit/push | Ejecutar `.github/workflows/backend-ci.yml` |

## 10. Conclusión

El backend P0 queda **`LOCAL_MVP_READY`**: completo y demostrable localmente, con pruebas críticas en verde, controles financieros, de aislamiento y de seguridad verificados, y una demo real en contenedores.

Las integraciones externas siguen **`EXTERNAL_INTEGRATION_UNVERIFIED`**, y COP real está **`BLOCKED_EXTERNAL`**. **No está desplegado.** No se hicieron commits ni push, y no se tocó ninguna base remota.
