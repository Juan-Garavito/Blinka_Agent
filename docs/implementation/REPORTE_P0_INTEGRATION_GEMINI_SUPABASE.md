# P0-INTEGRATION-GEMINI-SUPABASE

Fecha: 18-10-2026 (actualizado 14:50 tras la revisión de funcionamiento). **Gemini: VERIFICADO con llamadas reales (`REAL_VERIFIED`, 3/3 escenarios) usando `gemini-4-argon`. **Coste corregido: ver «Revisión 2».** Supabase: autenticado y vinculado, pero el backend AÚN NO funciona contra Supabase** porque faltan las credenciales de conexión (`apps/backend/.env.supabase` no existe); no hubo migraciones, roles, bucket ni escrituras remotas. Sin commits, push ni despliegue Railway. La incidencia de la CLI (`Initialising login role...`) sigue pendiente de auditar; ver sección B.

## Revisión 3 (18-10-2026, 18:10) — Supabase aprovisionado

Las escrituras remotas fueron bloqueadas para el agente por el sistema de permisos; **el usuario ejecutó** los comandos preparados con `REMOTE_DB_CONFIRM=aws-0-us-east-1.pooler.supabase.com/postgres` y `SEED_REMOTE_CONFIRM` (consentimiento propio del seed, nuevo; producción siempre rechazada).

Resultado verificado en solo lectura: `btree_gist` 1.7 en `extensions`; 17 migraciones (38 tablas) + Graphile rev. 20; `blinka_runtime` NOLOGIN con DML en 38 tablas; RLS 38/38; 0 permisos de `anon`/`authenticated`; bucket privado `blinka-documents` (10 MB, PDF/PNG/JPEG); seed ficticio: 1 empresa, 1 usuario, 9 proveedores, 8 contratos, 3 presupuestos, 15 facturas, 14 adjuntos, 29 documentos = 29 objetos en Storage; 0 corridas, cola vacía.

Incidencia: la primera ejecución del seed falló porque el bucket aún no existía (HTTP 400 con `statusCode:"404"`). Se corrigió `storage:prepare` para reconocer esa respuesta y el seed de demo se hizo reanudable (prueba `demo-seed-resume.test.ts`). Backend 271/271.

Pendiente de autorización: contraseña de `blinka_runtime` y `DATABASE_URL` runtime; API/worker FAKE contra Supabase + `demo:run`; prueba Gemini desde la interfaz; auditoría del rol temporal de la CLI.

## Revisión 2 (18-10-2026, 15:40) — coste corregido, Supabase preparado, prueba UI presupuestada

### 1. Coste corregido (sin nuevas llamadas facturables)

| Fuente | Antes | Corregido |
|---|---|---|
| Smoke final (`gemini-smoke.json`, 17 606 in / 6 121 out) | 0.03615825 | **0.09642200 USD** |
| Smoke Argon intento 1 | 0.00547275 | 0.01459400 |
| Smoke Argon intento 2 | 0.03030600 | 0.08081600 |
| Total Argon en `ai_usage_logs` (20 filas: 11 OK, 7 rechazadas por esquema, 2 fallidas sin uso) | — | **0.191832 USD** (ya era correcto) |

**Causa:** `gemini-smoke.ts` calculaba su informe y su corte de 0.25 USD con tarifas fijadas de gemini-3.8-flash (0.75/3.75) en coma flotante. `ai_usage_logs` **no** estaba afectado: usa Decimal y los precios del perfil (2.00/10.00), y `outputTokens` ya incluye `thoughtsTokenCount` (comprobado: 9 filas del smoke final suman exactamente 17 606 / 6 121 / 0.096422). Consecuencia adicional: el corte de 0.25 USD del smoke era en la práctica ≈2,7 veces más laxo.
**Corrección:** `estimateAiCostUsd()` (src/agents/ai-cost.ts, decimal) es ahora la única fuente para `ai_usage_logs` y para el smoke; el smoke registra los precios usados (`pricing`). Las tres evidencias Argon se recalcularon offline desde sus propios tokens, con `costCorrection` (valor anterior y motivo); `newCalls: 0`. Pruebas: `ai-cost.test.ts` (17 606/6 121 → 0.09642200; regresión de tarifas ajenas; el smoke no contiene tarifas literales).

### 2. Conexión a Supabase preparada (sin conectar)

- Perfil local `apps/backend/.env.supabase` creado (ignorado por Git, permisos 600) con todo lo NO secreto: `SUPABASE_URL=https://gagbmadasmzqsvbkxlmx.supabase.co`, bucket, `DATABASE_SSL=verify-full`, CA en `.certs/supabase-prod-ca-2021.crt` (ignorado), MOCK/FIXTURE explícitos, `REMOTE_DB_CONFIRM` vacío.
- **Session pooler obligatorio desde este equipo:** el host directo `db.gagbmadasmzqsvbkxlmx.supabase.co` solo resuelve IPv6 y no hay ruta IPv6 local. Pooler `aws-0-us-east-1.pooler.supabase.com:5432` (modo sesión, compatible con LISTEN/Graphile; datos leídos de la caché local de la CLI). Postgres 17.11.
- Roles separados: `MIGRATION_DATABASE_URL` = `postgres.gagbmadasmzqsvbkxlmx` (aprovisionamiento/DDL); `DATABASE_URL` = `blinka_runtime.gagbmadasmzqsvbkxlmx` (runtime sin DDL; **el rol no existe todavía**).
- Secretos con `npm run supabase:secrets -w @blinka/backend`: entrada oculta, sin argumentos ni impresión; codifica la contraseña para URL y valida el tipo de clave.
- **Claves `sb_secret_…`:** el adaptador NO era compatible del todo — enviaba `Authorization: Bearer <clave>` y la documentación indica que las claves nuevas van solo en `apikey` (no son JWT). Corregido en Storage y en `storage:prepare`: `sb_secret_` → solo `apikey`; `service_role` JWT heredada → Bearer + apikey; `sb_publishable_`/anon → rechazadas al arrancar (el error muestra solo el tipo). Pruebas unitarias añadidas. Sigue sin verificarse contra Supabase real.

**Datos que debe obtener el usuario del panel del proyecto `blinka_agent_demo`:**

| Dato | Dónde | Destino |
|---|---|---|
| Contraseña de la base (rol `postgres`) | Database Settings (o reset de contraseña) | `supabase:secrets` → MIGRATION_DATABASE_URL |
| Certificado CA (`prod-ca-2021.crt`) | Database Settings → SSL Configuration → Download | `apps/backend/.certs/supabase-prod-ca-2021.crt` |
| Clave secreta `sb_secret_…` | Project Settings → API Keys → Secret keys | `supabase:secrets` → SUPABASE_SERVICE_ROLE_KEY |
| Contraseña de `blinka_runtime` | Solo tras autorizar la creación del rol | Canal local seguro |

### 3. Preflight de solo lectura: READ_ONLY_VERIFIED (16:05)

Credenciales completadas por el usuario (contraseña, `sb_secret_`, CA `Supabase Root 2021 CA`, válida hasta 26-04-2031, SHA-256 `80:70:25:AD:…:CA:FA`, guardada en `.certs/` ignorado). `npm run integration:preflight -w @blinka/backend`, solo `BEGIN READ ONLY`, sin API ni worker:

| Comprobación | Resultado |
|---|---|
| Destino | Session pooler `aws-0-us-east-1.pooler.supabase.com:5432`, base `postgres`, proyecto vinculado `gagbmadasmzqsvbkxlmx` |
| Usuario | `postgres` (aprovisionamiento); no superusuario; CONNECT, CREATE en base y en `public`, CREATEROLE: **sí** |
| Versión | PostgreSQL **17.11** |
| TLS cliente → pooler | **verify-full comprobado en el socket**: TLS 1.3 `TLS_AES_256_GCM_SHA384`, `authorized=true`, certificado `*.pooler.supabase.com` → Supabase Intermediate 2021 CA → **Supabase Root 2021 CA** (archivo descargado), verificación de nombre de host |
| `pg_stat_ssl` = false | Corresponde al tramo interno Supavisor → Postgres dentro de Supabase, no a nuestra conexión |
| Extensiones | `btree_gist` **disponible, no instalada** (1.7; la crea la migración 0005 — requiere autorización); `pgcrypto` 1.3 instalada |
| Esquemas | `public` (uso y creación); `storage` (uso); **sin** `drizzle` ni `graphile_worker` → Graphile ausente: un arranque de API/worker **ejecutaría DDL** |
| Datos | 0 tablas en `public`; **ningún rol `blinka%`** (`blinka_runtime` no existe) |
| Storage (`storage:prepare`, solo GET) | Clave `sb_secret_` **aceptada** solo en `apikey` (listado de buckets HTTP 200, 0 buckets). Bucket `blinka-documents` **no existe**: Supabase responde HTTP 400 con `statusCode:"404"`; el script lo trataba como error y se corrigió. Estado: `AWAITING_AUTHORIZATION`, plan privado 10 MB PDF/PNG/JPEG, 0 escrituras |

**Advertencia de configuración:** el usuario puso también el rol `postgres` en `DATABASE_URL` (runtime). Válido para este preflight, pero el runtime NO debe usar el propietario: tras crear `blinka_runtime` (autorización) se debe reemplazar. Mientras tanto, `REMOTE_DB_CONFIRM` vacío impide arrancar API/worker contra Supabase. `--runtime` no se ejecutó (sería el mismo usuario `postgres`). La investigación del rol temporal creado por la CLI sigue **pendiente**.

### 4. Prueba de una factura desde el frontend con Gemini real: PREPARADA, NO EJECUTADA

**Tope duro nuevo:** `BudgetedAIProvider` (opcional; `AI_MAX_REQUESTS_PER_PROCESS` + `AI_MAX_COST_USD_PER_PROCESS`, juntos). Antes de cada llamada comprueba solicitudes y coste acumulado con `estimateAiCostUsd`; al agotarse lanza `BUDGET_EXCEEDED` **no reintentable** → la corrida termina en ERROR técnico y Graphile no reintenta. `--check-config` lo muestra (`processBudget`). Pruebas `ai-budget.test.ts`.

**Riesgo detectado y mitigado:** un worker de desarrollo `tsx watch` (iniciado 10:06, no por esta sesión) recargaba `.env` —ahora con `AI_PROVIDER=gemini`— en cada cambio de código, sin tope, sobre la cola de `blinka_dev`. Se comprobó que no gastó nada (cola vacía; 0 usos de Gemini fuera de los smokes) y **se detuvo** (`npm run dev:worker` lo restaura). Ninguna corrida RUNNING en `blinka_dev`.

**Presupuesto propuesto (requiere autorización):**

| Parámetro | Valor |
|---|---|
| Facturas | 1, ficticia: `docs/demo/factura-alfa-gemini-real.pdf` (ALFA-GEM-2026-10-001, 12 h × 30 USD = 360 USD, sin marcador MOCK) + `hoja-horas-alfa-gemini-real.pdf` |
| Base / storage | PostgreSQL **local** `blinka_dev`, storage local |
| Llamadas esperadas | 3 (herramientas, final, reparación), según el smoke |
| Coste esperado | ≈ **0.032 USD** (≈5 900 in / 2 000 out) |
| Tope de solicitudes | **4** por proceso |
| Tope de coste | **0.06 USD** (se evalúa antes de cada llamada; peor caso ≈ 0.09 USD con la última llamada) |
| Tiempo | `AI_TIMEOUT_MS=120000` por especialista; el worker se detiene al terminar la factura |

Comandos (NO ejecutados):

```bash
# 1) API + frontend compilado (puerto 4001 existente o uno nuevo) contra blinka_dev local, con MOCK desactivado solo en el worker.
# 2) ÚNICO worker de la cola, con Gemini y tope duro:
AI_MAX_REQUESTS_PER_PROCESS=4 AI_MAX_COST_USD_PER_PROCESS=0.06 AI_TIMEOUT_MS=120000 \
  npm run start:gemini-worker -w @blinka/backend
# 3) En el navegador: Nueva factura → Alfa Software → subir los dos PDF → Cargar y analizar → seguir el progreso.
# 4) Detener el worker; revisar ai_usage_logs de la corrida (provider GEMINI, isSimulated=false) y la evidencia.
```

### 5. Operaciones que requieren autorización explícita

1. Ejecutar la prueba de la sección 4 (gasto Gemini ≤ 0.06 USD, 1 factura, BD local).
2. ~~Preflight remoto de solo lectura~~ — ejecutado (READ_ONLY_VERIFIED).
3. Migraciones Drizzle + Graphile en Supabase (`db:migrate:supabase`), con `REMOTE_DB_CONFIRM`.
4. Crear el rol `blinka_runtime`, grants y RLS (`db:prepare:supabase -- --apply`) y asignar su contraseña.
5. Crear el bucket privado (`storage:prepare -- --apply`).
6. Seeds/escrituras ficticias en Supabase y arranque de API/worker contra remoto.
7. Auditoría del rol temporal creado por la CLI (`Initialising login role...`).

Regresión tras la revisión 2: lint, typecheck y build OK; **backend 269/269** (33 archivos); **frontend 28/28**. Sin commits, push ni despliegue; sin escrituras remotas.

## Resultado de las fases

| Servicio / fase | Estado real |
|---|---|
| Gemini — credencial | **OK**: `models.get` 200 para `models/gemini-4-argon` (`generateContent`, `countTokens`, `batchGenerateContent`). Cuenta de pago (Argon no existe en Free tier). |
| Gemini — pipeline real | **REAL_VERIFIED**: smoke aislado (misma composición LangGraph/harness del worker, BD y storage locales) procesó 3 facturas ficticias con Gemini real; resultados financieros y evidencias correctos. |
| Gemini — worker de cola | Config verificada (`--check-config`: provider=gemini, model=gemini-4-argon, clave presente, 0 solicitudes). **No** se arrancó un worker Gemini consumiendo la cola compartida. |
| Supabase CLI | **AUTHENTICATED** (2.121.0). `projects list` vuelve a listar `blinka_agent_demo` (us-east-1, ACTIVE_HEALTHY). |
| Proyecto vinculado | **LINKED**: `gagbmadasmzqsvbkxlmx` (supabase/.temp/project-ref). |
| Conexión backend ↔ Supabase | **BLOCKED (credenciales)**: falta `.env.supabase` (DSN de aprovisionamiento/runtime, CA, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, bucket). Sin ello no se puede ejecutar el preflight remoto ni probar Storage. |
| Migraciones, rol y storage remoto | **PREPARED / AWAITING_EXPLICIT_TARGET_AUTHORIZATION**, no ejecutados. |

## A. Gemini: configuración, modelo y evidencia

La variable real es **GEMINI_API_KEY** (solo backend/worker; nunca VITE_*). Se conserva `FakeAIProvider`/`AI_PROVIDER=fake` para regresiones. La clave nunca se imprimió ni se copió a archivos publicables.

### Modelo vigente: `gemini-4-argon`

El usuario cambió el perfil `.env.gemini` a **gemini-4-argon** (precios 2.00 / 10.00 USD por 1M). Comprobado contra la [documentación oficial](https://ai.google.dev/gemini-api/docs/latest-model?hl=en) el 18-10-2026:

- ID exacto `gemini-4-argon`; GA; **no disponible en Free tier** (la cuenta es de pago, confirmado por `models.get` 200).
- Precio introductorio hasta 30-11-2026: input 2.00, output (incluye pensamiento) 10.00 USD/1M; desde 01-12-2026: 4.00 / 20.00. Revisar `VERIFIED_PRICES` y el perfil antes de esa fecha.
- La documentación muestra la Interactions API, pero `models.get` confirma soporte de **`generateContent`**, que es lo que usa el adaptador; no fue necesario un adaptador nuevo.
- Ignora temperature/top_p/top_k (el `temperature: 0` enviado es inocuo); pensamiento con nivel por defecto `medium`.

El intento previo con `gemini-3.8-flash` (BLOCKED, BAD_REQUEST) se conserva en `evidence/integration/gemini-smoke-3.8-flash-intento-previo.json`.

### Por qué fallaba (diagnóstico real) y correcciones

1. **El listado ocultaba el modelo.** `listGeminiModels` filtraba solo nombres con `flash`; `gemini-4-argon` aparecía como “no disponible” aunque la clave tuviera acceso. Ahora la disponibilidad se comprueba con **`models.get` del modelo exacto** (1 GET, sin generación) y el modelo se toma del perfil (`GEMINI_MODEL`), sin alias ni fallback.
2. **Precios fijados en código para 3.8-flash.** El smoke exigía 0.75/3.75; ahora usa una tabla `VERIFIED_PRICES` por modelo y exige coincidencia con el perfil.
3. **Causa del HTTP 400 (la del fallo anterior).** Se aisló con 6 llamadas diagnósticas mínimas (sin documentos, ≤200 tokens de salida): el **esquema JSON completo generado por Zod** provocaba `400 INVALID_ARGUMENT` siempre; un esquema trivial funcionaba; el esquema **sin cotas numéricas** (`maxItems`/`minimum`/`maximum`) ni validaciones de texto (`pattern`, `format`, `minLength`, `maxLength`, `default`, `$schema`) devolvía 200. El fallo aparecía en la llamada de **reparación** porque era la primera del flujo que enviaba `responseJsonSchema`. Corrección: `toGeminiSchema()` en el adaptador elimina esas palabras clave **solo de la guía enviada al modelo**; **Zod sigue validando todas las restricciones** de la respuesta antes de usarla.
4. **Paso final con historial de herramientas.** El último paso omitía las declaraciones de herramientas aunque el historial contuviera `functionCall`/`functionResponse`. Ahora se declaran con `toolConfig.functionCallingConfig.mode = NONE` y se exige JSON (`final=true`); la reparación también es paso final.
5. **Plazo del especialista.** Argon con pensamiento tardó 4–31 s por llamada; con `AI_TIMEOUT_MS=60000` un especialista de 3 llamadas quedó sin tiempo (aborto local, no error de la API). Verificado con **120000 ms** (variable de entorno del comando; el perfil real `.env.gemini` del usuario **no se modificó**: conviene fijar `AI_TIMEOUT_MS=120000` allí). El template `.env.gemini.example` ya refleja modelo, precios y plazo.

Pruebas nuevas/actualizadas: esquema saneado, cuerpo del paso final (tools + NONE + JSON), paso intermedio sin forzar JSON, y harness (declaraciones conservadas con historial; sin historial no se declaran).

### Smoke real final: REAL_VERIFIED

Comando: `AI_TIMEOUT_MS=120000 npm run gemini:smoke -w @blinka/backend` (máx. 10 solicitudes, corte ante cualquier fallo, umbral 50 000 tokens / 0.25 USD, BD y storage locales, PDF ficticios sin marcador MOCK). Evidencia: `evidence/integration/gemini-smoke.json`.

| Escenario (PDF ficticio) | Resultado del motor | Motivo | Reservas | Evidencia determinista |
|---|---|---|---|---|
| conforme | **AUTORIZADA** (simulada) | ALL_CHECKS_PASSED | 1 | 13/13 TEXT_VERIFIED con posición |
| total inconsistente | **EN_CORRECCION** | TOTAL_ARITHMETIC | 0 | 13/13 |
| instrucción hostil en el documento | **AUTORIZADA** (la instrucción se ignoró; datos consistentes) | ALL_CHECKS_PASSED | 1 | 13/13 |

| Métrica | Valor |
|---|---|
| Solicitudes | 10 (1 `models.get` + 9 generaciones) |
| Tokens entrada / salida con pensamiento | 17 606 / 6 121 |
| Latencia por generación | 4,3 – 20,6 s |
| Coste estimado (lista) | **0.096422 USD** — corregido; el reporte original mostraba 0.036158 por tarifas de 3.8-flash fijadas en el script (`billingCost` real no disponible en la API) |
| Uso registrado | `ai_usage_logs` con provider GEMINI, `isSimulated=false` |
| Reentrega de la corrida finalizada | No cambia el número de reservas |

Observación de calidad: en los 3 casos la primera respuesta final no cumplió el esquema y se necesitó la **reparación única** (una llamada extra por factura). Funciona, pero cuesta ~30 % más; candidato a mejora (p. ej. forzar JSON también en el paso intermedio si el modelo lo admite junto a herramientas, a verificar).

Intentos de esta revisión, en orden (todos acotados): `models.get` 1; smoke 1 → BLOCKED HTTP 400 en la reparación (`gemini-smoke-argon-intento-1.json`); 6 llamadas diagnósticas mínimas; smoke 2 → 2 facturas OK, la tercera abortada por plazo de 60 s (`gemini-smoke-argon-intento-2.json`); smoke 3 → REAL_VERIFIED. Coste estimado total de la revisión (corregido): **0.191832 USD** en los tres smokes (ai_usage_logs) + ≈0.0085 USD de las 6 llamadas diagnósticas (no registradas en ai_usage_logs) ≈ **0.20 USD**. Los smokes crearon facturas ficticias solo en la base **local** `blinka_dev`.

**No verificado todavía:** worker Gemini consumiendo la cola real (`start:gemini-worker`) con la UI; calidad con documentos escaneados/imágenes; documentos reales de proveedores; carga concurrente y cuotas.

### Correcciones del adaptador

- Conserva en memoria el contenido/firma de llamadas a herramientas y sus IDs entre turnos; no registra prompts, documentos ni razonamiento.
- `outputTokens` suma candidatos y `thoughtsTokenCount`, que se facturan como salida. Los costes y límites dejan de omitir pensamiento conocido.
- Excluye partes `thought` de la interpretación JSON.
- Rechaza respuestas truncadas/bloqueadas y conserva usage conocido en el error para el registro del harness.
- El transporte del smoke limita host, evita claves en query, no sigue redirects y cierra el circuito ante fallos; reconoce también Google 400 `API_KEY_INVALID` como autenticación.

Zod sigue descartando campos como `decision` o `approved`. Las herramientas solo leen el proveedor/contratos permitidos. La reserva y la decisión final siguen siendo del motor determinista bajo transacción; no existe herramienta de IA que modifique esos datos.

## B. Supabase CLI, conexión y permisos

**Revisión 18-10-2026 14:50:** CLI autenticada (listado de proyectos OK, solo lectura), vínculo `gagbmadasmzqsvbkxlmx` vigente. **No existe `apps/backend/.env.supabase`**, por lo que no hay DSN de base de datos ni credenciales de Storage: el backend no puede conectarse, y el preflight remoto, las migraciones y el bucket siguen sin ejecutarse. Ninguna operación remota de escritura se ejecutó en esta revisión.

Instalación realizada: `supabase@2.121.0` como devDependency exacta de la raíz, lockfile actualizado y script `npm run supabase -- …`. `supabase init` creó la configuración local. Las migraciones y seeds de la CLI se deshabilitaron: **Drizzle sigue administrando las tablas de negocio** y Graphile su esquema propio. No se ejecutó `supabase start`, `db push`, `db pull`, `db reset` ni `config push`.

Autenticación, listado de organizaciones/proyectos y vínculo completados tras el aviso del usuario. Destino existente: **blinka_agent_demo**, ref **gagbmadasmzqsvbkxlmx**, región **us-east-1**, host **db.gagbmadasmzqsvbkxlmx.supabase.co**. No se creó ningún proyecto. El vínculo está confirmado en el archivo local ignorado de la CLI.

**Incidencia de permisos:** la ayuda de CLI 2.121.0 describe `db query --linked` como consulta mediante Management API. Se ejecutó SQL exclusivamente de metadatos, envuelto en BEGIN READ ONLY/COMMIT. Antes del resultado, la CLI imprimió `Initialising login role...`. Esto puede haber creado/configurado un rol interno antes de la transacción; READ ONLY no protege ese paso. No se puede afirmar que no hubo DDL remoto interno. Se suspendieron las operaciones remotas, sin intentar borrar el rol. El único resultado devuelto fue la existencia del esquema public; la CLI no conservó los resultados anteriores del lote. No demuestra permisos, TLS, identidad SQL ni persistencia de sesión. Auditar el evento/rol con el propietario antes de autorizar cualquier cambio. No repetir este comando como preflight seguro sin revisar su implementación y credenciales.

Fuentes: [CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), [tokens y permisos](https://supabase.com/docs/guides/platform/personal-access-tokens), [conexiones](https://supabase.com/docs/guides/database/connecting-to-postgres).

### Preflight de solo lectura

El script selecciona MIGRATION_DATABASE_URL por defecto o DATABASE_URL con `--runtime`; usa `BEGIN READ ONLY`, statement_timeout y cierre de conexión. Muestra solo host/puerto/base/usuario/versiones/permisos, nunca password ni DSN completo. Para remoto exige TLS verify-full y coincidencia del vínculo con el host directo o el usuario del Session pooler.

Comprobado localmente:

- Host 127.0.0.1:54329; base `blinka_dev`; usuario `blinka`.
- PostgreSQL **17.11**, transacción `read_only=on`.
- SSL **false**, aceptable solo para este PostgreSQL local; **no** es evidencia de TLS remoto.
- Rol local superuser, CONNECT/CREATE/CREATEROLE disponibles; **no** son permisos demostrados en Supabase.
- `btree_gist` instalado **1.7**, necesario para las restricciones EXCLUDE. `pgcrypto` disponible, no instalado; no debe instalarse por defecto si las primitivas requeridas ya están en PostgreSQL.
- Esquemas `public`, `drizzle`, `graphile_worker`; Graphile revisión **20**, correspondiente al paquete 0.18 instalado.

Pendiente en el destino remoto: repetir preflight de aprovisionamiento y runtime para identificar proyecto, host, base, usuario, TLS, versión, permisos reales y extensiones. No se comprobó una conexión PostgreSQL directa ni Supabase Storage. Hubo la consulta CLI remota parcial descrita arriba.

### Sesiones persistentes y DDL de Graphile

Graphile usa estado de sesión/LISTEN y necesita conexión directa o **Session pooler**. Se rechazan puerto 6543 y marcadores de transaction pooling. Copiar el host exacto de **Connect**; no deducirlo de la región. El pooler Session usa puerto 5432 y usuario con sufijo del project-ref; directo suele requerir IPv6 o el add-on IPv4.

La inspección del paquete confirmó que **tanto `run()` como `makeWorkerUtils()` pueden migrar Graphile al inicializarse**. El comentario previo de la cola de API era incorrecto y se corrigió. Ahora la inicialización perezosa de la API también exige `REMOTE_DB_CONFIRM` exacto antes de permitir ese acceso remoto; el worker conserva su guardia y añade validación de conexión persistente.

No se arrancaron API/worker contra remoto para “probar conexión”: eso podría ejecutar DDL o escribir trabajos. Una revisión desactualizada debe migrarse con el rol de aprovisionamiento antes del arranque. El rol runtime preparado no recibe CREATE ni ownership para que un cambio de versión no aplique DDL silencioso.

## Operaciones preparadas, NO ejecutadas remotamente

| Operación | Preparación y condición |
|---|---|
| Vínculo CLI | `supabase link --project-ref` tras autenticación y selección inequívoca; vínculo local, sin migraciones automáticas de negocio. |
| Drizzle + Graphile | Script `db:migrate:supabase`; carga perfil dedicado y conserva guardia/auditoría existente del destino. Espera autorización explícita. |
| Rol y seguridad de tablas | `scripts/prepare-supabase-runtime.sql` y `db:prepare:supabase`. Rol NOLOGIN, privilegios DML, RLS de tablas Blinka y revocación de acceso de anon/authenticated/PUBLIC; no modifica tablas ajenas. |
| Credencial del runtime | El operador habilita LOGIN y asigna password por canal local seguro después de aprobar el rol; no se incrusta en SQL ni React. |
| Bucket privado | `storage:prepare`: por defecto solo GET/plan. `--apply` exige destino vinculado y REMOTE_DB_CONFIRM antes del POST. Bucket privado, límite de tamaño y tipos PDF/PNG/JPEG; no convierte un bucket público existente ni lo sobrescribe. |

Los scripts de preparación son repetibles por existencia de rol/política/bucket y grants idempotentes. **La idempotencia de ese DDL no fue ejecutada en Supabase**, ni se afirma que los permisos de una organización desconocida permitan crearlos. La revisión del SQL debe acompañar la autorización final.

El backend sigue sirviendo documentos tras verificar sesión y empresa. No se añade SDK, clave privilegiada ni acceso directo al bucket desde React. No se habilitan políticas de Storage para clientes anónimos o autenticados del navegador.

## C. Configuración local contra remoto y diseño del smoke futuro

`.env.supabase.example` prepara los nombres reales: DATABASE_URL, MIGRATION_DATABASE_URL, DATABASE_SSL, DATABASE_SSL_CA_FILE, DATABASE_POOL_MAX, STORAGE_DRIVER, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET y REMOTE_DB_CONFIRM. Copiar a `.env.supabase` ignorado y completar localmente. **No reemplazar `.env` ni TEST_DATABASE_URL**. Los comandos dedicados cargan el perfil adicional y mantienen la suite local separada.

Plan de smoke remoto, todavía sin ejecutar ni habilitar automáticamente:

1. Preflight read-only del rol de aprovisionamiento y del runtime; demostrar TLS y Session/direct.
2. Presentar destino exacto y SQL/migraciones/bucket; obtener autorización explícita antes de DDL, seed o arranque de procesos remotos.
3. Migrar Drizzle y Graphile con rol de aprovisionamiento; aplicar grants/RLS aprobados; verificar por segunda vez permisos runtime y revisión 20.
4. Crear/validar bucket privado. Comprobar que los roles de navegador no tienen acceso, y que el backend autorizado sí puede subir/leer un documento ficticio.
5. Tras autorizar seed/escrituras, crear una empresa/evaluador/proveedor/contrato/política/presupuesto **ficticios y dedicados al smoke**, sin usar datos empresariales existentes.
6. API y worker locales con perfil remoto, primero FAKE para aislar infraestructura; login real con cookie/CSRF, consulta tenant-scoped y carga de **una** factura ficticia única. Luego análisis con Gemini solo con presupuesto de llamadas renovado y servicio ya validado.
7. Consultar versiones, corridas, etapas, evidencia determinista y audit/usage. Si la factura es consistente, comprobar exactamente una reserva y consumo horario; si es inconsistente, cero reservas y sin autorización.
8. Reentregar el mismo trabajo/corrida ya finalizada y verificar que no cambia el número de reservas ni llama otra vez a Gemini. Rechazar doble resolución con 409 y no mezclar datos entre empresas.
9. Conservar identificadores y métricas sin secretos; no borrar ni resetear datos remotos como limpieza automática.

No se generó un ejecutor remoto de escrituras que se active con `npm test`. Este plan no es una prueba remota ejecutada.

## Seguridad para GitHub público

- `.env`, perfiles reales `.env.gemini`/`.env.supabase`, cache `.temp`/`.branches` de CLI, access-token, `.pgpass`, `.netrc`, `.npmrc`, claves y certificados locales quedan ignorados. Templates `.example` son publicables y no tienen secretos.
- Se añadieron redacciones de MIGRATION_DATABASE_URL, SUPABASE_ACCESS_TOKEN y SUPABASE_DB_PASSWORD al logger. GEMINI_API_KEY ya estaba protegida; sigue viajando exclusivamente en cabecera.
- `security:public` inspecciona archivos que Git publicaría, patrones de claves/tokens/PEM/JWT y DSN remotos, sin imprimir valores. Resultado: **tres avisos de credenciales ficticias en pruebas existentes**, revisados como señuelos de validación/redacción en `processes.test.ts`, `provisioning.test.ts` y `db-target.test.ts`. Se mantienen visibles como REVIEW_REQUIRED, no se ocultan con una exclusión general de tests.
- No se detectaron claves Google/Supabase/GitHub reales ni private keys en los candidatos publicables. Las capturas existentes y los dos PDF de `docs/demo` son evidencia/demo ficticia; no se añadieron documentos empresariales. La clasificación automática es heurística y no certifica ausencia absoluta de secretos.
- Auditoría npm: cuatro hallazgos moderados en tooling dev de Drizzle/esbuild, cero altos/críticos; no se aplicó `audit fix --force` ni un cambio mayor del stack. Auditoría runtime con `--omit=dev`: **0 vulnerabilidades**.
- No hubo commit/push/deploy; los archivos previos siguen sin comprometerse.

## Cambios y regresiones

Cambios principales: protocolo Gemini y usage, transporte limitado/listado/smoke aislado, check-config del worker, guardia de cola API, preflight seguro, preparación de rol/RLS/bucket, CLI fijada/configurada, perfiles, auditoría pública y verificación MOCK aislada. Los únicos cambios de frontend son infraestructura de E2E: CI no guarda capturas/trazas, bloquea solicitudes externas del navegador y reutiliza sesión en memoria. No cambió diseño ni código de interfaz.

Resultados exactos de cierre y salidas sanitizadas: `evidence/integration/verification.txt`.

- Lint, typecheck y build desde raíz pasan.
- Frontend: **28/28** (7 archivos) tras la revisión; antes 14/14.
- E2E MOCK: **9/9** (50.3 s), API + worker reales y base **local aislada** `blinka_mock_dd5d9784_test`, sin cambios a credenciales de `blinka_test` y sin capturas de interfaz.
- Backend: **261/261**, 31 archivos, suite completa offline (259 previas + esquema saneado para Gemini + paso final con herramientas).

`verify:mock` conserva la base local aislada en lugar de borrarla; cierra sus procesos API/worker al terminar. No utiliza Supabase, Gemini real ni los presupuestos de `blinka_dev`.

## Siguientes comandos exactos

### Gemini (verificado)

```bash
# En .env.gemini (local, ignorado): GEMINI_MODEL=gemini-4-argon, precios 2.00/10.00, AI_TIMEOUT_MS=120000
npm run gemini:models -w @blinka/backend                 # 1 GET models.get, sin generación
npm run start:gemini-worker -w @blinka/backend -- --check-config
AI_TIMEOUT_MS=120000 npm run gemini:smoke -w @blinka/backend   # ≤10 solicitudes, ≈0.10 USD
```

Siguiente paso pendiente de autorización: arrancar el worker Gemini contra la cola **local** y probar la carga desde la interfaz con una factura ficticia (cada análisis ≈ 3 llamadas, ≈ 0.032 USD; ver presupuesto en «Revisión 2»).

### Supabase vinculado: falta `.env.supabase` (credenciales de conexión)

```bash
npm run supabase -- login
npm run supabase -- orgs list --output json
npm run supabase -- projects list --output json
# Solo si el listado identifica inequívocamente el proyecto Blinka existente:
npm run supabase -- link --project-ref <PROJECT_REF_DE_BLINKA>
```

En un entorno sin navegador, configurar SUPABASE_ACCESS_TOKEN mediante entrada oculta o gestor local de secretos, nunca como argumento literal en el historial. El token de CLI debe permitir las lecturas necesarias para listar/vincular. SUPABASE_SERVICE_ROLE_KEY es otra credencial, exclusiva del backend; no sustituye ese token.

Copiar `.env.supabase.example` a `.env.supabase`, completar las conexiones exactas de Connect y las claves localmente; dejar REMOTE_DB_CONFIRM vacío. No ejecutar `config push` ni comandos de migración de Supabase.

```bash
npm run integration:preflight
npm run integration:preflight -- --runtime
npm run storage:prepare             # GET/plan, sin --apply
npm run db:prepare:supabase          # muestra plan, sin --apply
```

Tras presentar y **autorizar expresamente** proyecto/host/base/operaciones, y solo entonces, fijar REMOTE_DB_CONFIRM al `host/base` exacto:

```bash
# PREPARADOS, NO EJECUTADOS EN ESTA FASE:
npm run db:migrate:supabase -w @blinka/backend
npm run db:prepare:supabase -- --apply
npm run storage:prepare -- --apply
```

Después de aprobar también escrituras del smoke y completar las credenciales runtime:

```bash
# PREPARADOS, NO EJECUTADOS CONTRA REMOTO:
npm run start:supabase-api -w @blinka/backend
npm run start:supabase-worker -w @blinka/backend
```

El template Supabase limita API local a 127.0.0.1:4003 y configura FAKE/FIXTURE explícitos; su HTTP/cookie local no es una configuración de producción. Los perfiles de Supabase no activan Gemini por defecto: el operador debe elegir explícitamente FAKE para la primera prueba de infraestructura o GEMINI_MODEL/AI_PROVIDER/clave/precios para una fase real ya autorizada. El valor de REMOTE_DB_CONFIRM es una guardia técnica y **no sustituye la autorización humana sobre el destino**.
