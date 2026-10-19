# @blinka/backend — Blinka FacturAction

Backend MVP **P0** del monorepo (ver [README raíz](../../README.md)): monolito modular **Node.js + Express 5 +
TypeScript** con **PostgreSQL / Drizzle**, **Zod**, **Graphile Worker** y **LangGraph.js**. Un mismo código produce
dos procesos: **`api`** (HTTP) y **`worker`** (cola + agentes).

> Autorizaciones y reservas **SIMULADAS** (nunca pagos reales). Aprobadores = personas **simuladas**.
> En local la IA es **FAKE (MOCK)** y las tasas FX son **FIXTURE simuladas**. **Frankfurter v2** (USD/COP, COP/USD,
> EUR/USD) está verificado con peticiones reales (`npm run test:external`); Gemini y Supabase Storage tienen
> adaptadores implementados pero **no verificados** contra los servicios reales.

Estado, decisiones y resultados: [`docs/implementation/REPORTE_BACKEND_P0.md`](../../docs/implementation/REPORTE_BACKEND_P0.md) ·
operación: [`RUNBOOK.md`](../../docs/implementation/RUNBOOK.md) · contrato HTTP provisional: [`docs/api/openapi.json`](../../docs/api/openapi.json)
(también en `GET /openapi.json`).

## Requisitos

- Node.js **≥ 24.7** (Argon2id de `node:crypto`); probado con 26.x, imagen Docker con Node 24 LTS.
- npm workspaces: instalar **desde la raíz** (`npm ci`).
- Docker + Compose para PostgreSQL local (127.0.0.1:54329).

## Módulos

```
src/
  server.ts / worker.ts     entrypoints api y worker
  app.ts / api.ts           Express (seguridad, logs, errores) / composición de módulos bajo /api
  composition.ts            servicios compartidos api+worker (FX, evaluación, pipeline)
  config/env.ts             entorno validado con Zod (reglas cruzadas de producción)
  openapi.ts                contrato HTTP provisional
  shared/                   db (pool, guardia de destino, migraciones, seeds, auditoría de aprovisionamiento),
                            errores, logger seguro, dinero decimal, rate limit en PostgreSQL
  modules/
    identity/               companies, users, company_users, auth_sessions; login Argon2id, CSRF, contexto de empresa
    audit/                  audit_events (append-only)
    company-config/         expense_categories, approval_personas (simuladas)
    vendors/                vendors, vendor_bank_accounts (huella HMAC + máscara)
    documents/              documents + almacenamiento privado (local / Supabase)
    contracts/              contracts, contract_versions, contract_items (validación por modalidad)
    invoices/               invoices, invoice_versions, invoice_lines, invoice_attachments
    policies/               company_policies, policy_versions, approval_matrix_rules
    fx/                     fx_rate_snapshots + proveedores (fixture, Frankfurter)
    budgets/                monthly_budgets, budget_reservations, budget_reservation_allocations
    evaluations/            DecisionEngine puro + EvaluationService transaccional; flows, runs, checks,
                            applied policies, stage runs, candidates, evidence; análisis asíncrono + polling
    approvals/              approval_requests (resolución simulada → reevaluación)
    dashboard/, demo/       agregados del panel; escenarios de demo locales
  agents/                   LangGraph pipeline, harness (allowlist, límites), extractor, proveedores IA, ai_usage_logs
  jobs/                     catálogo de tareas (techo de reintentos), cola, handlers
```

## Scripts del workspace

Desde la raíz: `npm run <script> -w @blinka/backend` (los principales tienen alias en la raíz).

| Script | Descripción |
|---|---|
| `dev` / `dev:worker` | API / worker con `tsx watch` y `.env` |
| `build`, `start`, `start:worker` | Compilar y ejecutar |
| `typecheck`, `lint`, `test` | Calidad (234 pruebas sin red; integración requiere `db:up`) |
| `test:external` | Pruebas contra servicios reales con red (Frankfurter v2), separadas de `test` |
| `db:generate` | SQL versionado desde el esquema (no conecta) |
| `db:migrate`, `db:migrate:test` | Migraciones con guardia de destino y registro auditable |
| `db:seed`, `db:seed:demo` | Seeds LOCALES idempotentes (identidad; + 13 escenarios de demo) |
| `demo:run` | Ejecuta la demo contra una API local |
| `openapi:export` | Exporta `docs/api/openapi.json` |

## Configuración

Ver [`.env.example`](.env.example) (copiar a `apps/backend/.env`). Validación Zod al arrancar; los mensajes nunca
incluyen valores. Reglas de producción: cookies Secure, orígenes https, `DATABASE_SSL=verify-full` para hosts
remotos, `ACCOUNT_FINGERPRINT_SECRET` obligatoria, IA/FX simuladas solo con `AI_ALLOW_FAKE` / `FX_ALLOW_SIMULATED`.

## Seguridad (resumen)

- Sesiones en PostgreSQL (token aleatorio en cookie `__Host-` HttpOnly/Secure/SameSite=Strict; la BD guarda su SHA-256),
  regeneración al login, expiración absoluta e inactividad, revocación.
- CSRF por capas (Origin/Sec-Fetch-Site + tipos de cuerpo no simples + token sincronizador). Rate limit compartido en PostgreSQL.
- Empresa resuelta desde la membresía; `X-Company-Id` solo selecciona y se valida. FKs compuestas `(company_id, id)`.
- Triggers de inmutabilidad (documentos, versiones, checks, reservas, auditoría…), CHECK de no sobregiro, triggers
  diferidos (2 asignaciones por reserva; AUTHORIZE ⇒ reserva).
- La IA no tiene herramientas de escritura; la decisión es siempre del `DecisionEngine` determinista.
- Evidencia documental obligatoria: cada valor usado para decidir se coteja con la capa de texto del documento
  original (`modules/evidence`); sin capa de texto, solo una confirmación humana auditada lo habilita.
- Tope de horas acumulado por período de servicio (`contract_hour_consumptions`) y recuperación automática de
  evaluaciones atascadas (cron `recover_stale_runs`).
- Guardia de bases remotas: migraciones y worker exigen `REMOTE_DB_CONFIRM=<host>/<db>`; seeds nunca en remoto.
