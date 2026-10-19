# Runbook — Blinka (backend + frontend) Blinka PayGuard AI (P0)

Todos los comandos se ejecutan desde la **raíz** del monorepo. Autorizaciones y reservas son **simuladas**.

## 1. Arranque local (desarrollo)

```bash
npm ci
cp apps/backend/.env.example apps/backend/.env   # completar SEED_EVALUATOR_PASSWORD y ACCOUNT_FINGERPRINT_SECRET (openssl rand -base64 48)
npm run db:up                                    # PostgreSQL 17 local 127.0.0.1:54329 (blinka_dev, blinka_test)
npm run db:migrate                               # Drizzle 0000–0016 + esquema graphile_worker
npm run db:seed                                  # empresa ficticia + evaluador (idempotente, solo local)
npm run db:seed:demo                             # opcional: 15 escenarios de demo A–O (idempotente)
npm run dev:api                                  # http://localhost:4000
npm run dev:worker                               # otra terminal
npm run demo:run                                 # opcional: analiza las facturas de demo y muestra la tabla
```

## 2. Demo en contenedores (Docker Compose)

```bash
npm run docker:up        # postgres → migrate (una vez) → api + worker (NODE_ENV=production, IA FAKE y FX FIXTURE declarados)
npm run db:seed:demo     # desde el host: misma BD local y carpeta apps/backend/.storage (montada en /data/storage)
npm run demo:run         # contra http://127.0.0.1:4000
# Otra base LOCAL (p. ej. para una demo limpia): BLINKA_DB=blinka_demo npm run docker:up  (crear antes la base vacía)
npm run docker:down      # elimina contenedores (conserva el volumen de datos)
```

Evidencia de una ejecución real: `docs/implementation/evidence/demo-compose-run.txt`.

## 3. Verificación

```bash
npm run lint && npm run typecheck && npm run build
npm run db:migrate:test && npm test       # requiere db:up; 199 pruebas
npm audit --omit=dev                      # runtime
npm run openapi:export                    # docs/api/openapi.json
npm run test:external                     # SOLO con red: Frankfurter v2 real (USD/COP, COP/USD, EUR/USD)
```

## 4. Flujo de una factura (API)

1. `POST /api/documents?kind=INVOICE` (cuerpo binario PDF/PNG/JPEG, cabecera `X-File-Name`).
2. `POST /api/invoices` `{ vendorId, documentId }` — proveedor obligatorio.
3. (Horas) `POST /api/documents?kind=EVIDENCE` + `POST /api/invoices/:id/attachments` `{ purpose: "TIMESHEET" }`.
4. `POST /api/invoices/:id/analysis` → `202 { runId, pollUrl }`.
5. Polling `GET /api/evaluation-runs/:runId` hasta `terminal: true` (etapas reales `queued → extracting → matching → validating → deciding → finished|failed`).
6. Detalle: `GET /api/invoices/:id/evaluations` (checks PASS/FAIL/UNKNOWN, políticas aplicadas, reserva).
7. Si `EN_APROBACION`: `GET /api/approval-requests?status=PENDING` → `POST /api/approval-requests/:id/resolve` `{ decision, reason }` (simulado; APPROVE reevalúa).

Alternativa sin IA: `POST /api/invoices` con `data` + `POST /api/invoices/:id/evaluations` (evaluación determinista síncrona).

## 4b. Evidencia documental (P0-HARDENING)

- Al subir un documento se extrae su **capa de texto** (`TEXT` | `NO_TEXT` | `UNPARSEABLE`, respuesta `textLayer`).
- Cada valor usado para decidir (número, total, moneda, fecha, cuenta, referencia de contrato, líneas…) debe
  aparecer en el texto del original. Si no aparece → `EN_CORRECCION · EVIDENCE_<CAMPO>`: corregir la versión
  **aportando el documento que respalda los nuevos valores** (`POST /api/invoices/:id/versions` con `documentId`).
- Imagen o PDF escaneado → `EVIDENCE_*` UNVERIFIABLE: una persona revisa el original
  (`GET /api/documents/:id/content`) y confirma los campos:
  `POST /api/invoices/:id/versions/:versionId/confirmations {"fields":[…],"reason":"…"}` (versión actual; auditado).
  En un PDF con texto esta confirmación se rechaza (409): una discrepancia nunca se "aprueba".
- Ubicación de cada evidencia: `evaluation_evidence` (página, `char_start/char_end`, fragmento real).

## 5. Recuperación y errores

| Síntoma | Causa probable | Acción |
|---|---|---|
| Estado `ERROR` · `FX_RATE` | Proveedor FX caído, par sin fuente en `FX_FRANKFURTER_SOURCES` o precisión insuficiente | Revisar el par/fuente (COP→BANREP, resto→BCE); `npm run test:external` comprueba Frankfurter v2 real; reintento manual en el mismo trámite |
| Estado `ERROR` · `PIPELINE_*` | Proveedor IA agotó reintentos (3) o fallo permanente | Revisar `ai_usage_logs` y `agent_stage_runs.error_code`; reintento manual: la extracción válida se **reutiliza** por huella |
| `409 ANALYSIS_IN_PROGRESS` | Ya hay una corrida RUNNING | Esperar. El worker ejecuta cada 5 min `recover_stale_runs`: si la corrida lleva > `RECOVERY_STALE_MINUTES` (15) sin actividad y sin trabajo vivo, cierra etapas huérfanas y la **reencola** (máx. `RECOVERY_MAX_ATTEMPTS`=2; luego `ERROR · STALE_RUN`). Un reintento manual tras `ANALYSIS_STALE_RUN_MINUTES` (30) también la cierra |
| `EN_CORRECCION · HOURLY_CAP` | Horas autorizadas del período de servicio + las de la factura superan el tope del contrato | Ver `contract_hour_consumptions`; corregir la factura (nota crédito) o versionar el contrato |
| `EN_CORRECCION · SERVICE_PERIOD_*` | Falta el período de servicio o abarca dos períodos contractuales | Facturar por período |
| `429 ANALYSIS_QUEUE_FULL` / `RATE_LIMITED` | Tope de análisis pendientes o rate limit por empresa | Esperar a que terminen; ajustar `ANALYSIS_MAX_PENDING_PER_COMPANY` / `ANALYSIS_RATE_LIMIT_PER_HOUR` |
| `401 SESSION_EXPIRED` | TTL absoluto (12 h) o inactividad (120 min) | Nuevo login |
| `403 CSRF_*` | Falta `X-CSRF-Token` o `Origin` no permitido | Usar el `csrfToken` de `/api/auth/session`; añadir el origen a `ALLOWED_ORIGINS` |
| Worker no arranca: "rechazada… no es local" | `DATABASE_URL` remota sin autorización | Ver §6; nunca arrancar el worker contra una BD remota sin autorización expresa |
| `migrate` falla con EACCES en contenedor | Registro de auditoría sin disco | La imagen usa `OPS_AUDIT_FILE=stdout` |

Consultas útiles (BD local):

```sql
select stage_code, attempt_no, status, error_code from agent_stage_runs where evaluation_run_id = '<runId>' order by started_at;
select rule_code, outcome, effect, reason from evaluation_checks where evaluation_run_id = '<runId>' order by seq;
select * from graphile_worker.jobs order by id desc limit 10;
```

## 6. Despliegue Railway (PREPARADO, NO EJECUTADO)

- Dos servicios del mismo repositorio e imagen (`apps/backend/Dockerfile`, contexto raíz):
  `deploy/railway/api.railway.json` (healthcheck `/ready`) y `deploy/railway/worker.railway.json`.
- Variables de producción: `NODE_ENV=production`, `TRUST_PROXY=1`, `ALLOWED_ORIGINS=https://<frontend>`,
  `SESSION_COOKIE_SECURE=true`, `DATABASE_SSL=verify-full` (+ `DATABASE_SSL_CA_FILE` con la CA de Supabase),
  `ACCOUNT_FINGERPRINT_SECRET`, `STORAGE_DRIVER=supabase` + `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_STORAGE_BUCKET` (bucket privado),
  `AI_PROVIDER=gemini` + `GEMINI_API_KEY` (o `AI_ALLOW_FAKE=true` para demo explícita), `FX_PROVIDER=frankfurter`
  (v2; `FX_FRANKFURTER_SOURCES=COP:BANREP,EUR:ECB,…`; salida HTTPS a api.frankfurter.dev) o `fixture` + `FX_ALLOW_SIMULATED=true`.
  Worker: `RECOVERY_STALE_MINUTES`, `RECOVERY_MAX_ATTEMPTS`, `RECOVERY_CRON`.
- **Conexión PostgreSQL**: el worker usa `LISTEN/NOTIFY` → conexión directa o *session pooler* (5432), nunca el *transaction pooler* (6543).
- **Separación de permisos**: `DATABASE_URL` (api/worker) con un rol de ejecución SIN DDL; `MIGRATION_DATABASE_URL`
  con rol propietario solo para `db:migrate`. Graphile solo ejecuta DDL si su esquema falta o está desactualizado:
  con rol sin DDL fallará en vez de migrar (deseado).
- **Migraciones remotas**: requieren autorización expresa, `REMOTE_DB_CONFIRM=<host>/<db>` y quedan registradas
  (JSONL o stdout). No se incluyeron como `preDeployCommand` a propósito.
- **Cookies entre sitios**: `*.up.railway.app` es sufijo público; frontend y API en subdominios distintos de
  railway.app son sitios distintos y `SameSite=Strict` no enviará la cookie. Servir el frontend desde el mismo
  origen (proxy `/api`) o dominio propio común.
- Rate limiting y sesiones en PostgreSQL: válidos con varias instancias de API.

## 7. Datos y seguridad

- Seeds solo locales (rechazados en producción y con host remoto, con o sin `REMOTE_DB_CONFIRM`).
- Nunca `drizzle-kit push`, reset, drop ni truncate; no existen scripts para ello.
- Documentos: claves generadas por el backend, archivos 0600 en local; descargas solo autenticadas.
- Logs: pino con redacción y serializador de errores sin parámetros SQL (verificado por prueba).

## Frontend: desarrollo, build y verificación

Arrancar API, worker y `npm run dev:web` en terminales independientes; abrir
http://localhost:5173. Vite reenvía `/api`, `/health`, `/ready` y `/openapi.json` a :4000.
`BLINKA_API_URL` cambia el destino del proxy solo en desarrollo.

```bash
npm run lint
npm run typecheck
npm run build
npm test -w @blinka/web
PW_CHROME=/usr/bin/google-chrome-stable npm run e2e -w @blinka/web
```

E2E usa la empresa ficticia del seed y modifica solo la base local de desarrollo.
Necesita presupuesto disponible y horas contractuales disponibles. Usa un entorno demo local
nuevo si se agotan; no borrar datos para conseguir un resultado verde.
Las pruebas del backend usan exclusivamente una base local con nombre terminado en `_test`.

## Frontend compilado desde la API (mismo origen)

`npm run build` crea `apps/backend/dist` y `apps/web/dist`. `npm run start -w @blinka/backend`
sirve automáticamente el frontend si existe ese directorio; sin build mantiene el modo solo API.
Docker compila el frontend y lo copia a la imagen compartida por API y worker.
Rutas profundas (`/invoices/:id/evidence`) devuelven index.html, assets con hash usan caché
inmutable y el HTML usa `no-cache`. API y assets inexistentes mantienen 404.
No hace falta CORS ni un servidor Vite en producción.

Para comprobar el build local, iniciar en otra terminal desde `apps/backend`:

```bash
PORT=4001 ALLOWED_ORIGINS=http://localhost:4001 node --env-file=.env dist/server.js
```

Luego, desde la raíz:

```bash
E2E_BASE_URL=http://localhost:4001 PW_CHROME=/usr/bin/google-chrome-stable npm run e2e -w @blinka/web -- journey.spec.js --project=desktop
```

Ese smoke local usa NODE_ENV=development y cookies locales. Para producción real, terminar HTTPS
en el proxy, declarar el origen HTTPS exacto en ALLOWED_ORIGINS y configurar TRUST_PROXY para
los saltos confiables; las cookies Secure requieren HTTPS. Compose usa un origen HTTPS de ejemplo:
para navegar con su configuración de producción se necesita ese proxy TLS.
No hubo despliegue como parte de FE5.

Los E2E reutilizan cookies de sesión solo en memoria por worker/proyecto. Si hay HTTP 429
al iniciar sesión, respetar Retry-After y esperar la ventana configurada; no desactivar
los límites ni limpiar sus contadores.


## P0-INTEGRATION-GEMINI-SUPABASE (estado: BLOCKED externo)

Informe: [REPORTE_P0_INTEGRATION_GEMINI_SUPABASE.md](REPORTE_P0_INTEGRATION_GEMINI_SUPABASE.md).
Gemini real no fue verificado: listado rechazado y cero generaciones. Supabase CLI 2.121.0
está instalada en la raíz, pero requiere autenticación; no hay proyecto vinculado ni DDL remoto ejecutado.

### Perfiles separados

- `.env`: entorno local habitual; TEST_DATABASE_URL no se cambia.
- `.env.gemini`: perfil ignorado, AI_PROVIDER=gemini y modelo/precios fijados; secreto desde
  entorno/archivo local. Templates vacíos de secretos en `.env.gemini.example`.
- `.env.supabase`: perfil ignorado para conexiones exactas Direct/Session del destino aprobado;
  TLS verify-full y storage privado. Template usa FAKE/FIXTURE explícitos para el primer smoke de infraestructura.

```bash
npm run start:gemini-worker -w @blinka/backend -- --check-config
npm run supabase -- login
npm run supabase -- orgs list --output json
npm run supabase -- projects list --output json
# Vincular SOLO un proyecto Blinka inequívocamente identificado:
npm run supabase -- link --project-ref <PROJECT_REF_DE_BLINKA>
# Después de configurar .env.supabase; solo lectura:
npm run integration:preflight
npm run integration:preflight -- --runtime
npm run storage:prepare
npm run db:prepare:supabase
```

No iniciar API/worker remotos como prueba de conexión: tanto run() como makeWorkerUtils()
pueden migrar Graphile. Sus accesos remotos requieren confirmación exacta del destino y
conexión directa o Session pooler, nunca :6543/transaction. Migraciones de negocio siguen en Drizzle;
no ejecutar supabase db push/pull/reset/config push. DDL, seeds, bucket y smoke remoto requieren
aprobación expresa sobre proyecto/host/base/operaciones antes de definir REMOTE_DB_CONFIRM.

Resolver el rechazo de Gemini antes de generar. El smoke aislado incluye listado, limita llamadas,
no reintenta errores y solo escribe datos ficticios locales. Ya se gastaron dos consultas GET del
presupuesto inicial; quedan como máximo ocho solicitudes si se mantiene esa misma ventana:

```bash
npm run gemini:smoke -w @blinka/backend -- --max-requests=8
```

No ejecutar además el listado sin descontarlo; no arrancar workers Gemini sin límites sobre una
cola compartida hasta validar el servicio y autorizar una nueva ventana de gasto. Para activación
posterior, API y worker deben compartir el mismo perfil Gemini y sus precios/modelo explícitos.

Regresión sin servicios externos, sin capturas de interfaz y sin tocar presupuestos de blinka_dev:

```bash
npm run build
npm run verify:mock
npm test -w @blinka/backend
npm test -w @blinka/web
npm run security:public
```

verify:mock crea una base LOCAL aislada terminada en _test, aplica migraciones/seed ficticio,
arranca API/worker en :4002 y fuerza FAKE/FIXTURE. Cierra esos procesos y conserva la base local.
La auditoría pública muestra tres señuelos ficticios de credenciales en tests como avisos de revisión;
ver informe. No añadir tokens CLI, perfiles reales, certificados privados ni documentos empresariales a Git.

## 8. App completa en este equipo «como en producción» (Supabase + Gemini)

Perfiles: `.env` (base local, IA FAKE) + `.env.supabase` (BD/Storage Supabase) + `.env.gemini` (Gemini real con tope duro por proceso). El lanzador compila, arranca API (sirve el frontend) y worker como procesos separados, con TLS verify-full, cookies `Secure`, logs JSON y FX real (Frankfurter v2). Única diferencia con un despliegue: `NODE_ENV=development`, porque el origen es `http://localhost` (producción exige `https://`).

```bash
npm run start:cloud:check     # valida la configuración, sin conectar a nada
REMOTE_DB_CONFIRM=aws-0-us-east-1.pooler.supabase.com/postgres npm run start:cloud
# → http://localhost:4003 (usar Chrome/Firefox: aceptan cookies Secure en localhost). Ctrl+C detiene ambos procesos.
```

Gemini **sin tope de gasto por proceso** (decisión del usuario: medir el gasto completando todo el proceso). Un análisis completo ≈ 3 llamadas ≈ 0.038 USD. Ver el gasto: `npm run ai:cost:supabase -w @blinka/backend` (o `ai:cost` en local; `-- --since=YYYY-MM-DD`), panel «Uso de IA» del Dashboard y Auditoría → Uso de IA. Para una prueba sin gasto, sobrescribir `AI_PROVIDER=fake` en el comando.

## 9. Producción con Docker Compose (Supabase + Gemini + HTTPS)

`docker-compose.prod.yml`: `api` y `worker` (misma imagen, `NODE_ENV=production`) + `caddy` (HTTPS automático, `deploy/caddy/Caddyfile`). Sin PostgreSQL local ni migraciones (Supabase ya migrado). Los contenedores cargan SOLO `.env.supabase` + `.env.gemini` (`format: raw`); la CA de Supabase se monta en solo lectura; la imagen no contiene secretos y corre como usuario `node`.

```bash
# Prueba en este equipo (certificado de la CA interna de Caddy; el navegador avisará):
REMOTE_DB_CONFIRM=aws-0-us-east-1.pooler.supabase.com/postgres npm run prod:up      # https://localhost
npm run prod:logs
npm run prod:down

# Servidor con dominio (DNS apuntando al servidor, puertos 80/443 abiertos → Let's Encrypt):
REMOTE_DB_CONFIRM=aws-0-us-east-1.pooler.supabase.com/postgres DOMAIN=blinka.midominio.com \
  PUBLIC_ORIGIN=https://blinka.midominio.com npm run prod:up
```

Variables: `DOMAIN` (sitio de Caddy), `PUBLIC_ORIGIN` (debe coincidir exactamente con la URL del navegador; si `HTTPS_PORT` ≠ 443, incluir el puerto), `HTTP_PORT`/`HTTPS_PORT`. Pendiente de endurecimiento: los contenedores usan el rol `postgres` (decisión de demo) y reciben `MIGRATION_DATABASE_URL`; en producción real, `blinka_runtime` y perfil sin credenciales de aprovisionamiento.

**Tope de gasto de IA (opcional, desactivado):** si se definen `AI_MAX_REQUESTS_PER_PROCESS` y `AI_MAX_COST_USD_PER_PROCESS` (juntos), cada worker se detiene al alcanzarlos y las facturas siguientes quedan en **Error técnico · `PIPELINE_AI_SPEND_LIMIT`** (antes `PIPELINE_BUDGET_EXCEEDED`): sin datos extraídos no hay decisión financiera posible. Hoy NO está configurado: el gasto se mide con `ai:cost`. No confundir con `BUDGET_GLOBAL`/`BUDGET_CATEGORY` (presupuesto financiero → **Bloqueada**). Siempre activos, por factura: `AI_MAX_STEPS`, `AI_MAX_TOTAL_TOKENS` y `AI_TIMEOUT_MS` del especialista, y 3 intentos de cola solo ante fallos transitorios.

## 10. Análisis masivo encolado (`analyze:batch`)

Encola por la API (misma ruta que la interfaz: sesión, CSRF, auditoría, cola Graphile), mantiene `--parallel` corridas en curso (la API admite 10 pendientes por empresa y 60 por hora; ante 429 espera 30 s y reintenta), sigue cada corrida hasta el resultado (máx. 6 min) y muestra la tabla y el **gasto de IA del lote** (diferencia de `ai_usage_logs`).

```bash
# Con la app en marcha (start:cloud → :4003, que es el valor por defecto)
npm run analyze:batch -- --dry-run                         # qué analizaría (pendientes + error)
npm run analyze:batch                                      # pendientes y en error
npm run analyze:batch -- --select=all --parallel=5         # todas (reanaliza)
npm run analyze:batch -- --api=http://127.0.0.1:4000 --select=correction --limit=10
```

`--select`: `pending` (sin evaluar), `error`, `correction`, `all`. El rendimiento real lo fija el worker: `WORKER_CONCURRENCY` (trabajos simultáneos, 2 por defecto) y `AI_MAX_CONCURRENCY` (llamadas a la IA simultáneas; 1 en `.env.gemini`). Con Gemini, ≈ 20–40 s y ≈ 0.038 USD por factura; para acelerar, subir ambos valores. Verificado con IA FAKE en local: 4 facturas en paralelo en 2 s con los resultados esperados; 0 USD.
