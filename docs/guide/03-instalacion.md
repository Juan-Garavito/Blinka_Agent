# 03 · Instalación

Cómo levantar **Blinka FacturAction** en cuatro escenarios, de menor a mayor dependencia externa. Todos los comandos se ejecutan desde la **raíz** del repositorio.

| Escenario | Necesitas | IA | Base de datos |
|---|---|---|---|
| [A. Local](#a-local-sin-claves-externas) | Node.js 24 + Docker | Simulada (MOCK) | PostgreSQL en Docker |
| [B. Local + Gemini](#b-local-con-gemini-real) | + clave de Gemini (plan de pago) | Gemini 4 Argon | PostgreSQL en Docker |
| [C. Local contra Supabase](#c-app-completa-contra-supabase-y-gemini) | + proyecto Supabase | Gemini o simulada | Supabase |
| [D. Producción con Docker Compose](#d-producción-con-docker-compose-y-https) | + servidor/dominio | Gemini | Supabase |

## Requisitos

- **Node.js ≥ 24.7** (se usa Argon2id nativo de `node:crypto`).
- **Docker** con Compose v2.
- npm (workspaces): instala **siempre desde la raíz** con `npm ci`.
- Opcional: `openssl` para generar secretos, Chrome o Firefox (aceptan cookies `Secure` en `localhost`).

## Perfiles de configuración

El backend lee variables de entorno validadas con Zod (los errores nunca muestran valores). Hay **tres perfiles**, todos ignorados por Git; las plantillas `*.example` sí se versionan:

| Archivo | Se carga | Propósito |
|---|---|---|
| `apps/backend/.env` | Siempre (base) | Desarrollo local: PostgreSQL en Docker, almacenamiento local, IA **simulada** |
| `apps/backend/.env.gemini` | Sobre la base, en comandos `gemini:*` y `start:cloud` | Gemini real: clave, modelo, límites y precios |
| `apps/backend/.env.supabase` | Sobre la base, en comandos `*:supabase`, `start:cloud` y producción | Conexión a Supabase (BD + Storage) |

> Nunca pongas secretos en archivos versionados, en variables `VITE_*` ni en la conversación con herramientas. La clave de Gemini y la clave secreta de Supabase solo las usa el servidor.

## A. Local sin claves externas

```bash
npm ci
cp apps/backend/.env.example apps/backend/.env
```

Edita `apps/backend/.env` y completa:

| Variable | Valor |
|---|---|
| `SEED_EVALUATOR_PASSWORD` | Contraseña del usuario evaluador de la demo |
| `ACCOUNT_FINGERPRINT_SECRET` | Secreto HMAC de ≥ 32 caracteres: `openssl rand -base64 48` |

El resto ya viene preparado para local (`AI_PROVIDER=fake`, `FX_PROVIDER=fixture`, `STORAGE_DRIVER=local`).

```bash
npm run db:up            # PostgreSQL 17 en Docker, 127.0.0.1:54329 (bases blinka_dev y blinka_test)
npm run db:migrate       # 17 migraciones + esquema de Graphile Worker
npm run db:seed          # empresa y evaluador ficticios (idempotente)
npm run db:seed:demo     # 15 escenarios de demostración (opcional)

npm run dev:api          # API en http://localhost:4000   (/health, /ready, /openapi.json)
npm run dev:worker       # worker de análisis (otra terminal)
npm run dev:web          # interfaz en http://localhost:5173 (otra terminal; proxy a la API)
```

Analiza las facturas de demo desde la interfaz o en lote:

```bash
npm run analyze:batch -- --api=http://127.0.0.1:4000
```

Pruebas:

```bash
npm run db:migrate:test && npm test     # backend + frontend (requiere db:up)
npm run e2e                             # Playwright contra la app en marcha
```

## B. Local con Gemini real

Gemini 4 Argon **no está disponible en el plan gratuito**; necesitas una clave de un proyecto de Google AI Studio con facturación.

```bash
cp apps/backend/.env.gemini.example apps/backend/.env.gemini
# Completa GEMINI_API_KEY en un editor local (no en la terminal ni en el historial)
npm run gemini:models -w @blinka/backend      # comprueba acceso al modelo: 1 consulta, sin generación
npm run build
npm run start:gemini-worker -w @blinka/backend -- --check-config   # valida sin llamar a la API
```

Para usarlo, arranca la API normal (`npm run dev:api`) y, en lugar de `dev:worker`, el worker con Gemini:

```bash
npm run start:gemini-worker -w @blinka/backend
```

Smoke acotado (3 facturas ficticias, ≤ 10 solicitudes, ≈ 0,10 USD):

```bash
AI_TIMEOUT_MS=120000 npm run gemini:smoke -w @blinka/backend
```

Coste de referencia observado: **≈ 0,038 USD por análisis completo** (3 llamadas). Consulta el gasto con `npm run ai:cost -w @blinka/backend`.

## C. App completa contra Supabase y Gemini

### 1. Proyecto y conexión

1. Crea (o elige) un proyecto en Supabase y vincúlalo con la CLI incluida en el repo:

   ```bash
   npm run supabase -- login
   npm run supabase -- link --project-ref <PROJECT_REF>
   ```

2. Copia la plantilla y completa los datos **no secretos** (URL del proyecto, host del *Session pooler*):

   ```bash
   cp apps/backend/.env.supabase.example apps/backend/.env.supabase
   ```

   | Variable | Dónde obtenerla |
   |---|---|
   | `MIGRATION_DATABASE_URL` | Botón **Connect → Session pooler** (usuario `postgres.<ref>`, puerto **5432**; nunca 6543) |
   | `DATABASE_URL` | Igual, con el rol de ejecución (`blinka_runtime.<ref>`) una vez creado; para una demo puede usarse `postgres` |
   | `DATABASE_SSL_CA_FILE` | **Database → Settings → SSL Configuration → Download certificate**; guárdalo en `apps/backend/.certs/` |
   | `SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | **Project Settings → API Keys → Secret keys** (`sb_secret_…`; se envía solo en la cabecera `apikey`) |
   | `ACCOUNT_FINGERPRINT_SECRET` | El mismo secreto con el que se siembren los datos |

3. Escribe los secretos con entrada oculta (codifica la contraseña para la URL y valida el tipo de clave):

   ```bash
   npm run supabase:secrets -w @blinka/backend
   ```

4. Preflight **de solo lectura** (TLS `verify-full`, versión, permisos, extensiones):

   ```bash
   npm run integration:preflight
   ```

> El *Session pooler* (IPv4, modo sesión) es compatible con `LISTEN/NOTIFY` de Graphile. La conexión directa `db.<ref>.supabase.co` suele ser solo IPv6.

### 2. Aprovisionamiento (escribe en Supabase)

Las operaciones remotas exigen una autorización explícita del destino exacto en cada comando, `REMOTE_DB_CONFIRM=<host>/<base>`; no se guarda en archivos.

```bash
export REMOTE_DB_CONFIRM=aws-0-us-east-1.pooler.supabase.com/postgres   # ejemplo: tu host/base
npm run db:extensions:supabase -w @blinka/backend   # btree_gist en el esquema extensions
npm run db:migrate:supabase -w @blinka/backend      # migraciones + Graphile
npm run db:prepare:supabase -- --apply              # rol blinka_runtime (sin DDL), grants y RLS
npm run storage:prepare -- --apply                  # bucket privado blinka-documents
SEED_REMOTE_CONFIRM=$REMOTE_DB_CONFIRM npm run db:seed:demo:supabase -w @blinka/backend   # datos ficticios
unset REMOTE_DB_CONFIRM
npm run integration:preflight                       # comprobar el resultado
```

El seed remoto exige su **propio** consentimiento (`SEED_REMOTE_CONFIRM`) y se rechaza siempre en producción. Si falla a mitad (p. ej. bucket inexistente), puede repetirse: reanuda creando solo lo que falta.

### 3. Arrancar todo

```bash
npm run start:cloud:check                                              # valida configuración, sin conectar
REMOTE_DB_CONFIRM=aws-0-us-east-1.pooler.supabase.com/postgres npm run start:cloud   # http://localhost:4003
```

`start:cloud` compila y arranca API (que sirve el frontend) y worker con los tres perfiles, TLS `verify-full`, cookies `Secure`, logs JSON y tipo de cambio real (Frankfurter). Para probar sin gastar en IA, añade `AI_PROVIDER=fake` al comando.

## D. Producción con Docker Compose y HTTPS

`docker-compose.prod.yml` levanta `api` y `worker` (misma imagen, `NODE_ENV=production`) detrás de **Caddy**, que obtiene el certificado HTTPS automáticamente. No incluye PostgreSQL local ni migraciones: la base es Supabase, ya aprovisionada.

```bash
npm run prod:check                      # valida la configuración de Compose

# Servidor con dominio (DNS apuntando al servidor, puertos 80/443 abiertos → Let's Encrypt)
REMOTE_DB_CONFIRM=<host>/<base> DOMAIN=facturas.tudominio.com \
  PUBLIC_ORIGIN=https://facturas.tudominio.com npm run prod:up

npm run prod:logs
npm run prod:down
```

| Variable | Uso |
|---|---|
| `DOMAIN` | Sitio de Caddy (`localhost` usa la CA interna de Caddy; el navegador avisará) |
| `PUBLIC_ORIGIN` | Debe coincidir **exactamente** con la URL del navegador (incluye el puerto si no es 443) |
| `HTTP_PORT` / `HTTPS_PORT` | Puertos publicados (80/443 por defecto) |
| `REMOTE_DB_CONFIRM` | Autorización explícita del destino de base de datos |

Los contenedores cargan **solo** `.env.supabase` y `.env.gemini` (sin la base local); la CA de Supabase se monta en solo lectura y la imagen no contiene secretos (usuario no root).

**Recomendado para producción real:** usar el rol `blinka_runtime` en `DATABASE_URL`, guardar los secretos en el gestor del servidor y fijar topes de gasto de IA si se desea (`AI_MAX_REQUESTS_PER_PROCESS` + `AI_MAX_COST_USD_PER_PROCESS`).

También hay plantillas para **Railway** (`deploy/railway/*.json`): dos servicios de la misma imagen; Railway proporciona HTTPS.

## Problemas comunes

| Síntoma | Causa probable | Solución |
|---|---|---|
| `403 CSRF_*` al iniciar sesión | El origen del navegador no está en `ALLOWED_ORIGINS` | Añadir el origen exacto (`http://localhost:5173`, etc.) |
| Login correcto pero sin sesión | Navegador que no acepta cookies `Secure` en `http://localhost` | Usar Chrome o Firefox, o `SESSION_COOKIE_SECURE=false` solo en local |
| `401 SESSION_EXPIRED` | Sesión de 12 h o 120 min de inactividad | Volver a iniciar sesión |
| Worker: «rechazada… no es local» | `DATABASE_URL` remota sin autorización | Añadir `REMOTE_DB_CONFIRM=<host>/<base>` al comando |
| Factura en *Error técnico* · `FX_RATE` | Moneda sin tasa (tasas simuladas) o proveedor FX caído | Usar Frankfurter (`FX_PROVIDER=frankfurter`) o reintentar |
| *Error técnico* · `PIPELINE_TIMEOUT` con Gemini | Plazo del especialista corto para un modelo con pensamiento | `AI_TIMEOUT_MS=120000` en `.env.gemini` |
| `409 ANALYSIS_IN_PROGRESS` | Ya hay un análisis en curso para esa factura | Esperar; la recuperación automática cierra corridas atascadas |
| `429 ANALYSIS_QUEUE_FULL` | Más de 10 análisis pendientes en la empresa | Esperar o usar `analyze:batch`, que reintenta solo |
| Preflight remoto: TLS rechazado | Falta la CA de Supabase o ruta incorrecta | Revisar `DATABASE_SSL_CA_FILE` |

Más detalle operativo en [`docs/implementation/RUNBOOK.md`](../implementation/RUNBOOK.md).
