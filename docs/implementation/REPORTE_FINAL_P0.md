# Blinka PayGuard AI — Reporte final P0 (primera versión)

Fecha: 18-10-2026. Hackathon 30X. Agente B2B de cuentas por pagar con **autorizaciones y reservas presupuestarias SIMULADAS** (nunca pagos reales).

**Estado general:** primera versión **completa y verificada en local** (backend, worker con agentes, frontend). **Gemini 4 Argon verificado con llamadas reales**. **Supabase aprovisionado** (estructura, rol runtime, RLS, bucket privado y datos ficticios de demo; ejecutado por el usuario y verificado en solo lectura). Pendiente: arrancar API/worker contra Supabase. Sin despliegue y sin commits.

Informes de detalle: [Backend](REPORTE_BACKEND_P0.md) · [Hardening](REPORTE_P0_HARDENING.md) · [Frontend](REPORTE_FRONTEND_P0.md) · [Integración Gemini/Supabase](REPORTE_P0_INTEGRATION_GEMINI_SUPABASE.md) · [Runbook](RUNBOOK.md) · [Decisiones D-001…D-064](DECISIONS.md) · [Registro](execution-log.md)

## 1. Qué hace el producto

1. El evaluador carga una factura (PDF o imagen) y **elige obligatoriamente el proveedor**.
2. Un worker (Graphile + LangGraph) extrae los datos con IA, busca el contrato, valida y entrega el caso a un **motor de decisión determinista** (la IA nunca decide).
3. Cada dato usado para decidir se **coteja con el texto real del documento** (página y posición); si no aparece → corrección; sin texto (escaneo) → confirmación humana auditada.
4. Resultado visible: **Autorizada** (con reserva simulada del presupuesto global y de categoría), **En aprobación** (persona aprobadora simulada), **En corrección**, **Bloqueada**, **Rechazada** o **Error técnico**.
5. Todo queda en auditoría append-only; el uso de IA en `ai_usage_logs` con coste estimado.

## 2. Paquetes entregados

| Paquete | Contenido | Estado |
|---|---|---|
| B0 Fundación | Monorepo npm workspaces, Express 5 + TS, Drizzle/PostgreSQL 17, Docker Compose, logger seguro | DONE |
| B1 Identidad | Empresas, usuarios, sesiones en BD (cookie `__Host-`, Argon2id), CSRF, rate limit en PostgreSQL, contexto de empresa | DONE |
| B2 Comercial y documentos | Proveedores, cuentas (huella HMAC), contratos por modalidad, facturas versionadas, almacenamiento privado | DONE |
| B3 Motor financiero | DecisionEngine puro, políticas versionadas, matriz de aprobación, FX, presupuestos sin sobregiro | DONE |
| B4 Agentes y cola | LangGraph (4 etapas), harness con herramientas de solo lectura, análisis asíncrono + polling | DONE |
| B5 Human-in-the-loop | Aprobaciones simuladas (aprobar ⇒ reevaluación), rechazo ≠ bloqueo, sin override | DONE |
| B6 Integración | Dashboard, OpenAPI (48 rutas), demo A–O, Docker/Railway/CI preparados | DONE (sin despliegue) |
| P0-HARDENING | Evidencia verificada en texto, tope acumulado de horas, Frankfurter v2 (COP), recuperación automática | DONE |
| FE0–FE5 | React 19 + Vite: Dashboard, facturas, carga con proveedor obligatorio, progreso real, Evidence Studio, gestión, auditoría, responsive | DONE |
| P0-INTEGRATION | Gemini 4 Argon real; Supabase aprovisionado (migraciones, rol, RLS, bucket, seed demo) | Gemini DONE · Supabase aprovisionado (procesos remotos pendientes) |

## 3. Real frente a simulado

| Componente | Estado |
|---|---|
| Pagos | **Nunca reales**: autorizaciones y reservas simuladas |
| Personas aprobadoras | Simuladas (ficticias) |
| IA de extracción | **Gemini 4 Argon real verificado** (smoke 3/3); FAKE (MOCK) por defecto en local y pruebas |
| Tipo de cambio | Frankfurter v2 real verificado (USD/COP, COP/USD, EUR/USD); FIXTURE en local |
| Base de datos | PostgreSQL local verificado; **Supabase: 38 tablas + Graphile rev. 20, TLS verify-full verificado** |
| Storage | Local verificado; **Supabase Storage: bucket privado con 29 documentos de demo** (clave `sb_secret_` vía `apikey`) |
| Despliegue | Railway/Docker/CI preparados, **no ejecutados** |
| Datos | Empresa, proveedores, contratos y facturas **ficticios** |

## 4. Verificación

| Prueba | Resultado |
|---|---|
| Lint / typecheck / build (raíz) | OK |
| Backend (Vitest, unitarias + integración con PostgreSQL y Graphile reales) | **271/271** |
| Frontend (Vitest + Testing Library) | **28/28** |
| E2E Playwright contra backend real (desktop, tableta, móvil) | 9/9 en la verificación FE5; recorrido prioritario y capturas reconfirmados después |
| Externas reales | Frankfurter v2 3/3; Gemini 4 Argon `REAL_VERIFIED` 3/3 |
| Auditoría npm | Runtime 0 vulnerabilidades; 4 moderadas en tooling de desarrollo |
| Auditoría de publicación | Sin secretos reales detectados; 4 señuelos ficticios en pruebas, revisados |

## 5. Gemini 4 Argon (resultado y coste)

| Escenario (PDF ficticio) | Resultado | Reservas | Evidencia |
|---|---|---|---|
| Conforme | Autorizada | 1 | 13/13 verificada en texto |
| Total inconsistente | En corrección (TOTAL_ARITHMETIC) | 0 | 13/13 |
| Instrucción hostil en el documento | Autorizada (instrucción ignorada) | 1 | 13/13 |

Coste estimado de lista (2.00 / 10.00 USD por millón, salida incluye pensamiento): smoke final **0.096422 USD** (17 606 / 6 121 tokens); total de la integración con Argon **0.191832 USD** + ≈0.0085 de diagnóstico. Coste real de facturación no disponible por API. Correcciones clave: esquema JSON compatible con Gemini, paso final con herramientas en modo NONE, disponibilidad por `models.get`, precios por modelo, plazo de 120 s y **tope opcional por proceso** (`BudgetedAIProvider`, hoy desactivado: el gasto se mide con `npm run ai:cost` / `ai:cost:supabase` y el panel del Dashboard).

## 6. Supabase

Proyecto `blinka_agent_demo` (`gagbmadasmzqsvbkxlmx`, us-east-1), Session pooler `aws-0-us-east-1.pooler.supabase.com:5432`, PostgreSQL 17.11, TLS 1.3 **verify-full** con la CA Supabase Root 2021.

Ejecutado por el usuario (las escrituras remotas estaban bloqueadas para el agente) y verificado en solo lectura el 18-10-2026:

| Elemento | Estado |
|---|---|
| Extensión `btree_gist` | 1.7 en esquema `extensions` |
| Migraciones | 17 Drizzle (38 tablas en `public`) + Graphile revisión 20 |
| Rol `blinka_runtime` | Creado, **sin login** todavía; permisos DML en 38 tablas; sin DDL |
| Seguridad | RLS activo en 38/38 tablas; **0 permisos** para `anon`/`authenticated` |
| Bucket `blinka-documents` | Privado, 10 MB, solo PDF/PNG/JPEG |
| Datos ficticios (seed demo) | 1 empresa, 1 evaluador, 9 proveedores, 8 contratos, política, 3 presupuestos, **15 facturas**, 14 hojas de horas; **29 documentos = 29 objetos en Storage** |
| Análisis | 0 corridas, cola vacía (aún no se ha arrancado ningún worker contra Supabase) |

Incidencia resuelta: la primera ejecución del seed falló al subir el primer documento porque el bucket no existía (Storage responde HTTP 400 «Bucket not found»). El seed de demo se hizo **reanudable** (si existe la configuración y hay 0 facturas, reutiliza lo creado y crea solo las facturas; con facturas no toca nada), con prueba de integración. No se borró nada en remoto.

Siguientes pasos (requieren autorización): asignar contraseña a `blinka_runtime` y ponerlo en `DATABASE_URL` (hoy `postgres`); arrancar API y worker **FAKE** contra Supabase y ejecutar `demo:run` (análisis de las 15 facturas); después, una factura con Gemini real. Auditar el rol temporal que creó la CLI.

## 7. Cómo ejecutar en local

```bash
npm ci
npm run db:up && npm run db:migrate && npm run db:seed && npm run db:seed:demo
npm run dev:api        # :4000
npm run dev:worker     # IA según .env (FAKE por defecto)
npm run dev:web        # :5173 (proxy same-origin a la API)
```

Producción same-origin: `npm run build` y la API sirve el frontend compilado (ver RUNBOOK).

App completa con Supabase + Gemini real, como en producción (excepto `NODE_ENV`, por `http://localhost`):

```bash
npm run start:cloud:check
REMOTE_DB_CONFIRM=aws-0-us-east-1.pooler.supabase.com/postgres npm run start:cloud   # http://localhost:4003
```

## 8. Pendientes y límites conocidos

1. Arrancar API/worker contra Supabase con el rol `blinka_runtime` y probar login, carga y análisis (FAKE primero).
2. Completar la prueba con Gemini desde la interfaz sobre Supabase y medir el gasto total (`ai:cost:supabase`); hasta ahora US$0.086 en Supabase, ≈ US$0.038 por análisis completo.
3. Despliegue (Railway u otro) y dominio común frontend/API (la cookie `SameSite=Strict` lo exige).
4. Mejora de coste: cada factura necesitó una llamada de reparación de esquema (~30 % extra).
5. Escenario O del seed antiguo con PNG inválido; edición de empresa sin endpoint.
6. Calidad de IA no evaluada con documentos reales ni escaneados; auditoría exhaustiva de accesibilidad pendiente.
7. Historial Git: sin commits todavía; plan de commits en preparación.
