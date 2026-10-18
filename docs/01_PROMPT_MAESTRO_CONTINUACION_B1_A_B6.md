# BLINKA PAYGUARD AI — PROMPT MAESTRO DE CONTINUACIÓN AUTÓNOMA

**Modo:** trabajo prolongado, por paquetes, sin revisión intermedia obligatoria.  
**Alcance:** terminar **B1 en progreso** y continuar **B2 → B3 → B4 → B5 → B6** hasta entregar el **backend MVP P0** funcional, verificable y preparado para integrarse al frontend.  
**Fecha de la instrucción:** 18-10-2026.  
**Para:** Claude trabajando en el repositorio local de Blinka PayGuard AI.  
**IMPORTANTE:** este prompt **NO inicia B1 de cero**. B1 **ya está en desarrollo** en la sesión actual.

## 0. Interpreta correctamente lo solicitado

El usuario quiere aprovechar la sesión para avanzar de manera autónoma mientras está ausente, **sin detenerse a solicitar aprobación después de cada paquete**. Esta instrucción **reemplaza exclusivamente** la antigua obligación de parar al acabar B1/B2/etc. del plan inicial; **no elimina** ninguna regla de seguridad, restricción de datos o prohibición de despliegue.

- **B0** = fundamento técnico: ya se reportó terminado con 39 pruebas exitosas, monorepo npm workspaces, Express 5/TS, Drizzle, Graphile Worker, Docker local. **NO repetir B0 ni reorganizar el repositorio desde cero.**
- **B1** = identidad y aislamiento empresarial: **ya está implementándose**. **Continúa y termina lo que haya avanzado**; no destruyas ni reemplaces cambios en curso.
- **B2–B6** = paquetes siguientes del backend MVP P0. **Implementar consecutivamente sin esperar mensajes intermedios del usuario**, salvo que una acción requiera consentimiento explícito por motivos de seguridad o acceso externo.
- **F0** en la especificación antigua = fase de análisis/documentación; **P0** = demo de extremo a extremo. Cuando aquí digo “terminar fase 0”, me refiero **al backend MVP P0**, no a rehacer documentos F0 ni a volver al paquete B0.
- No es un encargo de rediseñar el frontend: React/Vite y UX/UI continúan en paralelo. Implementa el **backend** y contratos HTTP provisionales documentados sin suponer que los diseños visuales son definitivos.

**Trabaja únicamente en la sesión/repositorio existentes. Si B1 sigue ejecutándose, deja que termine su operación actual y prosigue ahí; NO abras un segundo agente/proceso concurrente que escriba en ese árbol o migre la misma base.**

## 1. Fuentes de verdad; léelas antes de continuar

En orden de precedencia:

1. **Decisiones recientes de este prompt** y decisiones aprobadas explícitamente por el usuario.
2. `Blinka_PayGuard_AI_Modelo_ER_v1_2.md`: **31 entidades, relaciones, estados, versiones, dos asignaciones de reserva**.
3. `Blinka_PayGuard_AI_Arquitectura_Logica_v1_1.md`: agentes, harness, workers, reintentos por etapa, locks, idempotencia y presupuestos.
4. `blinka_payguard_fase0_base_diseno_v1_1.md` y `blinka_fase0_especificacion_v0_4.md`: reglas de negocio, escenarios de demostración y alcance.
5. `Blinka_PayGuard_AI_Plan_Backend_para_Claude_v1_0.md`: paquetes B0–B6; su requisito previo de detenerse tras cada paquete queda **sustituido por la autorización de continuidad en este prompt**.
6. Repositorio, tests, migraciones y decisiones ya implementadas en B0/B1, siempre que no contradigan controles de seguridad.
7. UX/UI `Blinka_PayGuard_AI_Reglas_Diseno_v2_1.md` solo como guía visual futura, no para construir el frontend.

**Preflight corto y no destructivo:** identifica branch/Git (si ya existe), `git status`, cambios de B1, scripts, migraciones, tests disponibles, README, versión de runtime y dependencias. Continúa desde el estado real. Nunca presupongas que B1 está pendiente si ya existen archivos y migraciones.

**Convenciones finales:**
- Decisiones internas del motor: `AUTHORIZE`, `BLOCK`, `ESCALATE`.
- Estados comerciales: `AUTORIZADA`, `BLOQUEADA`, `EN_APROBACION`, `EN_CORRECCION`, `RECHAZADA`, `ERROR`.
- Estados técnicos de jobs/etapas **no** crean nuevos estados comerciales.
- Tipos de contrato: `RECURRING`, `HOURLY`, `MILESTONE`, `PURCHASE_ORDER`.
- Moneda base de empresa configurable; demo en USD, facturas USD/COP/EUR.
- Reservas imputadas a **mes de autorización simulada, zona horaria de `companies.timezone`**, no a mes de emisión o vencimiento.
- **Modelo ER v1.2 vigente:** `budget_reservations` + `budget_reservation_allocations`; exactamente dos asignaciones (GLOBAL, CATEGORY) con igual importe base **para el mismo compromiso**, no doble gasto.
- La IA jamás dicta la autorización final, inventa FX ni modifica presupuestos, cuentas bancarias, políticas o contratos confirmados.

## 2. Regla de autonomía: avanza sin perder seguridad

### Permitido sin consulta intermedia

- Investigar en el código actual, crear/modificar código de **backend**, pruebas, fixtures ficticias, README, documentación técnica, migraciones **versionadas**.
- Ejecutar `npm ci`, build, lint, typecheck, test, pruebas de integración, Docker Compose **local** y migraciones en **bases locales dedicadas y verificadas**.
- Crear servicios propios de Express, adapters de Gemini/Frankfurter/Supabase Storage, interfaces, y mocks locales verificables, sin llamadas externas si no existen credenciales.
- Ejecutar test suites tantas veces como haga falta, registrar errores y corregirlos.
- Registrar decisiones conservadoras y avanzar a etapas siguientes cuando no exista bloqueo real.
- Preparar configuración de Railway y workflows de CI como **archivos**, sin conectar ni desplegar recursos remotos.
- Ejecutar `git init` **solo si el usuario lo autorizó ya y el directorio todavía no tiene Git**, sin hacer commits.

### Prohibido sin autorización adicional explícita

- `git commit`, `git push`, abrir PRs remotos, publicar releases, desplegar Railway, crear recursos de pago, cambiar credenciales o iniciar cobros.
- Ejecutar migraciones/seed/reset/drop/truncate sobre Supabase remoto, DB compartidas/staging/prod u otras bases no locales.
- Realizar acciones destructivas, reescribir historial Git, borrar datos existentes, `docker compose down -v`, `rm -rf` de proyectos, o tocar contenedores ajenos.
- Activar permisos demasiado amplios de storage o exponer claves privilegiadas al navegador.
- Crear pagos reales, transferencias bancarias, uso de APIs de Blinka inexistentes, KYC real o cuentas bancarias reales.
- Relajar controles financieros o de aislamiento para que pase una demo.

**Guardia para DB:** antes de migraciones/seeds/test que escriban, verificar host real, nombre de base, ambiente y permisos. Registrar el destino sin credenciales. Cualquier objetivo que no sea local y dedicado requiere confirmación explícita del usuario, aunque exista `REMOTE_DB_CONFIRM`; no usar un valor de entorno antiguo como sustituto de consentimiento nuevo. El worker Graphile puede instalar/actualizar su esquema: considerarlo DDL, nunca arrancarlo en remoto inadvertidamente. Conexiones Graphile requieren modo sesión para `LISTEN/NOTIFY`; no utilizar pooler transaccional. Para Supabase remoto preparar TLS con validación completa de certificado/host, sin probarlo secretamente.

### Si surge un bloqueo real

Trabaja alrededor **sin inventar resultados ni debilitar seguridad**. Deja un adaptador mock **explícitamente marcado solo para tests/demo local** y conserva la integración real pendiente. Si un componente crítico no pudo probarse con proveedores reales por falta de credenciales o autorización, registra `BLOCKED_EXTERNAL` en el informe; **no declares integración real operativa**. Sigue construyendo lo que no dependa de ese bloqueo. No improvises datos financieros externos.

## 3. Arquitectura que debes mantener

```
/                     npm workspaces, Docker Compose, scripts raíz
├── apps/backend/      un monolito modular Express + TS
│   ├── api            proceso HTTP
│   └── worker         proceso Graphile Worker + LangGraph.js
├── apps/web/          reservado para React + Vite; no desarrollar UI ahora
├── docker/postgres/   Postgres/test local
└── docs/              informes/decisiones
```

Servicios y repositorios separados por dominio, **sin microservicios ni API HTTP interna entre especialistas**. Harness de agentes con allowlist de tools read-only, validación de parámetros, company context seguro, limits de steps/tokens/tiempo/concurrencia, mitigación de prompt injection, logs de uso y evidencia. Graphile coordina la entrega de trabajos; LangGraph ejecuta el grafo; `agent_stage_runs` conserva intentos/auditoría. El motor financiero es 100% TypeScript/SQL decimal y determinista.

**Stack:** Express + TypeScript, Drizzle + PostgreSQL, Zod, Graphile Worker, LangGraph.js, Gemini como IA primaria mediante interfaz reemplazable por OpenAI, Storage privado mediante adapter Supabase, Frankfurter como **candidato** FX real y fixtures FX locales para pruebas. Frontend futuro React/Vite JavaScript + polling. Railway Hobby como destino futuro, Docker Compose local. **No Jev**.

## 4. Continuación B1 — terminar, no empezar de nuevo

Revisa los cambios existentes y completa lo que falte:

- Tablas `companies`, `users`, `company_users` y sesión persistente; relaciones, FK, índices, unicidad y restricciones relevantes; moneda base y timezone.
- Login/logout/me con Argon2id, regeneración de sesión, cookies HttpOnly/Secure/SameSite; expiración, revocación, controles de origen/CSRF y rate limit. La sesión no se almacena en RAM en producción. Configurar `trust proxy` de forma limitada para Railway.
- Resolver la empresa de membresía autorizada desde datos de sesión/BD. Si existe selector de empresa, toda selección se valida contra membresía; nunca se confía en un `company_id` arbitrario.
- Seed local idempotente, con secretos por variables de entorno, **no contraseñas codificadas**; dos empresas en tests aunque la demo tenga solo una.
- Pruebas negativas de acceso sin sesión, sin membresía, CSRF, sesión caducada, rate limit y aislamiento cruzado. Ejecutar regresión de las 39 pruebas iniciales.

Si ya terminó B1, **no lo reescribas**: ejecuta sus pruebas, registra resultado y sigue B2.

## 5. B2 — Dominio comercial, documentos y facturas

Implementar **modelos y servicios reales** (no solo endpoints vacíos) conforme a ER v1.2:

- `expense_categories`, `approval_personas` (si resulta necesario al preparar B5), `vendors`, `vendor_bank_accounts` con estado `PENDING/AUTHORIZED/BLOCKED` o equivalentes definidos en el ER y validación independiente de cuenta. FK por empresa/proveedor. No terceros beneficiarios.
- `documents`: metadatos privados, tipo/MIME/tamaño, SHA256, storage key y control empresa. Adapter de almacenamiento desacoplado: **Supabase Storage cuando haya credenciales y permiso**, adapter local para desarrollo e integración; nunca URLs públicas permanentes. Validar extensión/MIME real, nombre seguro, archivo vacío, tamaño máximo configurable, path traversal y acceso cruzado. No ejecutar PDFs ni confiar en su texto.
- `contracts`, `contract_versions`, `contract_items` con modalidades `RECURRING / HOURLY / MILESTONE / PURCHASE_ORDER`, vigencias, ítems, moneda, tarifa, cantidad, períodos, hitos/OC, FKs, versiones inmutables. Contrato manual confirmable sin IA y sugerencias de IA **no activas** hasta confirmar expresamente por humano autenticado; preservar evidencia/fuente y auditoría.
- `invoices`, `invoice_versions`, `invoice_lines`: **proveedor obligatorio al cargar factura**, vínculo documento-factura, original intacto, versión corregida como nueva versión, identidad comercial normalizada `(company_id, vendor_id, invoice_number_normalized)` cuando disponible (UNIQUE parcial). Un documento fiscal reemitido con **número diferente** es otra factura, opcional `replaces_invoice_id`, no una versión interna.
- Casos difíciles (sin factura identificable, moneda desconocida, discrepancia proveedor/documento, duplicado aparente): conservar original y marcar para corrección, **jamás autorizar por suposición**.
- Endpoints REST *provisionales* documentados para gestionar proveedores, cuentas, contratos, documentos y facturas, todos autenticados, con validación Zod y pruebas.
- Evitar exponer rutas de documentos o datos de empresas ajenas. Servicios con verificaciones de membresía y FKs adecuadas, no solo filtros superficiales.

**Criterio de salida:** usuario local puede crear proveedor y cuenta, contrato estructurado/versión confirmada, subir factura ligada al proveedor y persistir original privado y datos/versiones con pruebas de aislamiento; no pago real.

## 6. B3 — DecisionEngine determinista y seguridad financiera

Entidades: `company_policies`, `policy_versions`, `approval_matrix_rules`, `evaluation_applied_policies`, `fx_rate_snapshots`, `monthly_budgets`, `budget_reservations`, `budget_reservation_allocations`, `evaluation_checks`, y referencias a ejecuciones según ER. Diseñar dependencias para que no requieran un LLM.

- **Validar** proveedor y cuenta autorizados, factura y versión inmutables, identidad normalizada/no duplicada, contrato del proveedor/categoría/tipo, vigente y confirmado, moneda explícita, tarifa/cantidad/periodo/hito/evidencia, aprobación humana si supera límite auto, políticas aplicables acumulativas (empresa/categoría/proveedor/contrato) y precedencia restrictiva.
- `hard_invoice_cap_base`: **BLOCK sin override humano**; `auto_approval_limit_base`: `ESCALATE` si exige aprobación. Proveedor/cuenta `BLOCKED`: `BLOCK`; `PENDING` requiere habilitación de entidad/cuenta, nunca sólo aprobar factura. Documento/campo crítico o contrato faltante/inconsistente: `EN_CORRECCION`. Duplicado confirmado: `BLOCK`. Presupuesto global/categoría insuficiente: `BLOCK`. Falla de FX sin tasa utilizable o de servicio externo: `ERROR`. Prioridad `BLOCK > EN_CORRECCION > EN_APROBACION > AUTORIZADA` (error técnico separado); registrar todos los checks pertinentes cuando sea seguro.
- FX real: `ExchangeRateService` con `fetch` nativo, Frankfurter candidato por defecto solo si válido para las divisas y política; almacenar fuente/fecha/importe de tasa y determinar si es apta. Fines de semana: último día hábil según política de frescura, nunca tasa inventada. USD base y USD factura ⇒ 1, snapshot/convención rastreable. Decimal exacto con `NUMERIC` y biblioteca decimal o aritmética entera escalada; **no JS Number para dinero**. Probar COP, EUR y USD.
- `monthly_budgets` GLOBAL y CATEGORY por empresa/mes. Calcular mes desde `authorized_at` y timezone de compañía con calendario local; **presupuestos ambos mismo mes**, independientemente de la fecha de emisión de factura.
- **Autorización atómica:** transacción DB con idempotencia por factura y operación; orden fijo de locks (factura, presupuesto global, presupuesto categoría); revalidar bajo bloqueo versiones/contrato/cuenta/política/FX y saldos; crear **una sola** `budget_reservations` y **dos** `budget_reservation_allocations`, aumentar `reserved_base` de cada presupuesto como perspectiva de la misma obligación, registrar decisión/auditoría y commit. UNIQUE(invoice_id) o índice equivalente de reserva válida; no duplicar al reintentar o con dos workers concurrentes. Rollback completo en fallos intermedios. Expiración/cancelación automática de autorizadas **fuera del MVP**.
- Pruebas de carrera y negativas: autorizaciones paralelas, redelivery de cola, underflow, doble reserva, FX ausente, política vencida, duplicados, aprobaciones no válidas, límites, categorías y frontera de mes/timezone.

**Criterio de salida:** el motor decide con entradas tipadas sin Gemini y demuestra **cero autorizaciones indebidas en los escenarios probados**; no reclamar garantías matemáticas universales.

## 7. B4 — Agentes y procesamiento asíncrono

- LangGraph.js dentro del proceso worker del monolito con grafo acotado: `EXTRACT_CLASSIFY` → `CONTRACT_MATCH` → `CONTRACT_VALIDATE` → `FINANCIAL_DECISION`. El último nodo llama al `DecisionEngine` en código: el LLM no puede aprobar ni reservar.
- Gemini como proveedor inicial: adapter intercambiable; soportar salida estructurada tipada y extracción PDF/imágenes cuando la integración real sea posible. Modelo/versiones configurables; OpenAI como alternativa **interfaz y diseño**, sin integrar/cobrar obligatoriamente dos proveedores. Si no hay créditos/credenciales, usar `FakeAIProvider` **exclusivamente para tests/local**, marcado visualmente/logs, y dejar el modo Gemini real bloqueado explícitamente, sin presentarlo como prueba exitosa de IA real.
- Tools: sólo lectura y restringidas por factura/proveedor/empresa del contexto confiable. SQL parametrizado en repositorios; no tool `execute_sql`, `authorize_invoice`, `change_vendor_account`, `modify_policy` ni `reserve_budget` expuestas al modelo.
- Harness: instrucciones de seguridad por especialista (documentos como contenido no confiable), allowlist real, aislamiento, límites configurables de pasos, tokens, tiempo y concurrencia, schemas Zod y validación de evidencias. No almacenar cadena de pensamiento oculta.
- Evaluaciones: `evaluation_flows`, `evaluation_runs`, `agent_stage_runs`, `evaluation_contract_candidates`, `evaluation_evidence`, `evaluation_applied_policies`, `ai_usage_logs` y auditoría; trazabilidad por empresa, factura, documento, versión, modelo y políticas.
- Reintentos **por etapa** con límites explícitos, errores temporales vs permanentes, fingerprints de entradas/versiones, checkpoints persistentes coherentes, reutilización de resultados válidos y nueva etapa al invalidar dependencias. No reejecutar IA si existe salida reutilizable válida. Si se agota retry ⇒ `ERROR` técnico; extracción insuficiente ⇒ `EN_CORRECCION`; ambos deben poder recuperarse de forma controlada.
- API de enqueue devuelve ID de evaluación/flujo sin esperar respuesta. Polling autenticado devuelve etapas **reales** y resultado; no porcentaje ficticio ni razonamiento interno. El worker termina tras escalar a humano; la respuesta humana dispara otro flujo después.
- Límite de concurrencia y abuso de rutas IA; logs de tokens, proveedor, modelo y coste estimado; no quota diaria arbitraria del usuario.
- Pruebas de integración con Graphile real en PostgreSQL local + fake provider y fixtures de documentos ficticios, cubriendo error/timeout/reentrega/invalidación; test de Gemini real sólo si condiciones seguras están disponibles y resultado etiquetado claramente.

**Criterio de salida:** una factura ficticia transita por etapas persistidas, herramientas seguras y motor determinista, terminando con estado adecuado; se puede consultar por polling y recuperar una falla parcial.

## 8. B5 — Human-in-the-loop, correcciones y auditoría

- `approval_requests` con persona aprobadora **simulada**, una sola tabla para solicitud/resolución; no RBAC real ni cuentas separadas de aprobadores. Marcar en API/documentación que la resolución es **simulada** por el evaluador autenticado.
- `APPROVED`: NO autorizar directamente; volver a evaluar FX, contrato, presupuesto, políticas y cuenta en nueva corrida/flujo y sólo después transacción segura. `REJECTED` ⇒ `RECHAZADA` con registro auditado, distinto de `BLOQUEADA`.
- `EN_CORRECCION`: no permitir override “aprobar de todos modos”; exigir nueva evidencia o nueva versión de factura/contrato autorizada y reevaluación vinculada al historial. Contratos generados por IA requieren confirmación humana para ser elegibles.
- Eventos append-only auditados con actor real o sistema, datos originales/versiones y sin secretos. Exponer explicación estructurada, checks `PASS/FAIL/UNKNOWN`, valores esperado/observado, políticas y evidencia, sin inventar causalidad.
- Pruebas: intento de aprobar invoice bloqueada/por encima de hard cap, doble click aprobación, rechazo, corrección, cambio entre solicitud y autorización, no reserva antes de aprobación, nuevo flujo y auditoría.

**Criterio de salida:** flujo de escalamiento/resolución/reanálisis seguro y explicable.

## 9. B6 — Integración backend, estabilidad y preparación de entrega

- Cerrar endpoints REST necesarios para el frontend React futuro: sesiones, dashboard con agregados, CRUD de configuración, subida de documento + proveedor, facturas/listado/detalle/versiones, evaluaciones, progreso por polling, comprobaciones/evidencia, aprobaciones, presupuestos y auditoría. **Documentar contratos HTTP en OpenAPI o esquema equivalente**, como interfaz *provisional* y validada con tests, sujeta a ajustes UX. No crear frontend React ahora.
- Semillas de demostración locales idempotentes, totalmente ficticias y con varios casos: válida, límite duro, umbral de aprobación, duplicado, proveedor/cuenta bloqueado o pendiente, discrepancia horaria, falta contrato, presupuesto insuficiente, FX COP/EUR, error técnico y corrección. Incluir al menos dos empresas en tests para aislamiento; demo con una empresa.
- Tests end-to-end backend desde API a worker/DB con proveedor IA y FX controlados, y pruebas de inyección de instrucciones en documentos de prueba, sanitización, rate limiting y secrets en logs.
- Health/readiness, logs correlacionados, métricas de uso IA, control de concurrencia, timeout y reintentos; documentación de env vars y runbooks de arranque/recovery/errores. Auditoría de dependencias y alertas documentadas.
- Preparar Railway: misma imagen o fuente del backend, `api` y `worker` como servicios independientes; frontend Vite futuro podría servirse desde API cuando exista. Documentar configuración de pool PostgreSQL compatible con LISTEN/NOTIFY, HTTPS/trust proxy/cookies y storage/FX. **NO hacer deploy real**.
- Ejecutar desde raíz `npm ci`, `typecheck`, `lint`, `build`, `test` con Postgres local, `docker:up`/`ready` (sólo entornos locales controlados) y otras pruebas reales posibles. Registrar comandos/resultados exactos.

**Criterio de salida:** MVP de backend P0 corre localmente de extremo a extremo con fixtures controladas, integraciones remotas encapsuladas y bien rotuladas, documentación clara y sin despliegue remoto.

## 10. Estrategia de ejecución prolongada — no parar entre fases

1. Terminar B1 actual; **no reiniciarlo**.
2. Crear en `docs/implementation/` un registro breve `execution-log.md` y una lista de progreso `B1…B6` con pruebas por etapa; este archivo no reemplaza el código ni los tests.
3. Completar B2 → B3 → B4 → B5 → B6 en orden de dependencia. Puedes crear primero esqueleto de entidad de una fase posterior solo cuando sea imprescindible para FK, pero no construir un subsistema prematuro o ignorar transacciones.
4. Al cerrar cada fase, correr tests relevantes y regresión general, registrar resultados y continuar **sin pedir nueva autorización**. Si falla una prueba, arreglarla antes de avanzar; si no es posible y queda bloqueada por causa externa, etiquetar bloqueo y proseguir con frentes independientes.
5. Mantener cambios locales, **sin commits, push ni deploy**. No tocar Supabase real ni Railway sin autorización explícita.
6. Optimizar uso de contexto: resumir decisiones e hitos en archivos del repo para recuperación si la sesión se interrumpe. No afirmar que el trabajo seguirá sin límites si la plataforma cierra la sesión.
7. Evitar sobreingeniería: no framework complejo de multi-tenancy, no Kafka, Redis, microservicios, RAG/vectorial obligado, websockets, Jev, notificaciones externas o pago real. Usar código simple y fiable.
8. Si el usuario no está disponible, **adopta decisiones reversibles y conservadoras** por defecto, documenta supuestos; **detente únicamente ante acciones que requieran autorización, riesgos irreversibles o falta de acceso indispensable**.

## 11. Formato del informe final obligatorio

Crear `docs/implementation/REPORTE_BACKEND_P0.md` con:

1. Estado **real** por fase (DONE / PARTIAL / BLOCKED), fechas y resumen.
2. Tabla de archivos/migraciones principales por fase.
3. Tabla de endpoints y payloads JSON representativos.
4. Diagrama textual de modules, API/worker y flujo de factura.
5. Suites de pruebas, comandos exactos, resultados medidos, advertencias y lo NO probado.
6. Comprobación de seguridad: multiempresa, auth/cookies/CSRF/rate limit, secrets, documents, idempotencia, concurrencia y DDL remoto.
7. Evidencia de ejecución local de escenarios A→B→C, incluida una autorizada, una bloqueada, una escalada y reintento.
8. Decisiones y desviaciones con justificación, deuda técnica priorizada, posibles riesgos del hackatón.
9. Qué necesitarías del usuario para pruebas **reales** de Gemini, Storage Supabase, FX y despliegue Railway, sin activar nada hasta recibir autorización.
10. **No afirmar que P0 está listo si hay pruebas críticas fallidas o integraciones clave sólo simuladas.** Distinguir `LOCAL_MVP_READY`, `EXTERNAL_INTEGRATION_UNVERIFIED`, `BLOCKED` y `NOT_READY`.

**Resultado esperado:** avanzar lo máximo posible del backend MVP P0, sin detenerte artificialmente tras B1, pero preservando seguridad, honestidad de pruebas y reversibilidad. Continúa ahora desde el punto exacto de B1 donde te encuentras.
