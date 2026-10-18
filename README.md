# Blinka PayGuard AI

Monorepo del MVP de la hackatón 30X: agente de cuentas por pagar con **autorizaciones y reservas
simuladas** (nunca pagos reales).

```
apps/
  backend/   @blinka/backend — Node.js + Express + TypeScript; procesos api y worker (mismo código)
  web/       @blinka/web — React + Vite + JavaScript; interfaz de evaluación
docker/      infraestructura local (init de PostgreSQL)
docs/        especificación, ER v1.2, arquitectura v1.1, plan backend, reglas de diseño
docker-compose.yml
```

- Gestor de paquetes: **npm workspaces**, con un único `package-lock.json` en la raíz.
  Ejecuta `npm ci` en la raíz, nunca dentro de una app.
- Node.js ≥ 24.7.0. Docker + Compose para PostgreSQL local.

## Inicio rápido

```bash
npm ci
cp apps/backend/.env.example apps/backend/.env
npm run db:up          # PostgreSQL 17 local (127.0.0.1:54329; bases blinka_dev y blinka_test)
npm run db:migrate     # migraciones sobre la base LOCAL
npm run db:seed        # empresa ficticia + evaluador (secretos desde apps/backend/.env)
npm run db:seed:demo   # opcional: 15 escenarios de demo A–O
npm run dev:api        # API en http://localhost:4000  (/health, /ready, /openapi.json)
npm run dev:worker     # worker, en otra terminal
npm run dev:web        # interfaz http://localhost:5173, en otra terminal
npm run demo:run       # opcional: analiza las facturas de demo
npm test               # pruebas de todos los workspaces (requiere db:up)
```

## Scripts de la raíz

| Script | Qué hace |
|---|---|
| `dev:api`, `dev:worker` | Backend en modo desarrollo (API / worker) |
| `build`, `typecheck`, `lint`, `test` | Se ejecutan en todos los workspaces |
| `db:up`, `db:down` | Arranca / detiene solo PostgreSQL local |
| `db:generate`, `db:migrate`, `db:migrate:test` | Migraciones Drizzle del backend (ver guardia en su README) |
| `db:seed`, `db:seed:demo`, `demo:run` | Seeds locales y ejecución de la demo |
| `openapi:export` | Exporta el contrato provisional a `docs/api/openapi.json` |
| `docker:build` | Construye la imagen `blinka-payguard-backend:local` |
| `docker:up` | Levanta postgres → migrate → api + worker en contenedores |
| `docker:down` | Detiene y elimina los contenedores del proyecto (conserva el volumen de datos) |

Un script concreto de una app se ejecuta con `npm run <script> -w @blinka/backend`.

## Imágenes Docker

| Imagen | Dockerfile | Contexto | Procesos |
|---|---|---|---|
| `blinka-payguard-backend` | `apps/backend/Dockerfile` | raíz del repo | `node dist/server.js` (api, por defecto) · `node dist/worker.js` (worker) |
| *(web)* | *pendiente* | — | — |

```bash
docker build -f apps/backend/Dockerfile -t blinka-payguard-backend .
```

Estado del backend P0 y evidencias: [`docs/implementation/REPORTE_BACKEND_P0.md`](docs/implementation/REPORTE_BACKEND_P0.md).
Despliegue Railway preparado (no ejecutado): `deploy/railway/` + [RUNBOOK](docs/implementation/RUNBOOK.md). CI preparado: `.github/workflows/backend-ci.yml`.

Detalles del backend (configuración, seguridad de BD, estructura y cola): [`apps/backend/README.md`](apps/backend/README.md).

## Frontend P0

Dashboard, facturas, análisis con polling, evidencia con posiciones reales, confirmación humana,
aprobaciones simuladas y administración están implementados. La carga comienza en **Nueva factura**;
el Dashboard muestra el resumen operativo. La guía de componentes está en `/style-guide`.

```bash
npm run lint
npm run typecheck
npm run build
npm test -w @blinka/web
PW_CHROME=/usr/bin/google-chrome-stable npm run e2e -w @blinka/web
```

E2E requiere API + worker locales, seed demo y proveedor FAKE (MOCK). Las pruebas crean facturas
y reservas simuladas en la base de desarrollo; las repeticiones consumen el presupuesto y el tope
de horas del período. No usar bases remotas. Credenciales desde `E2E_EMAIL`/`E2E_PASSWORD`
o el evaluador de `apps/backend/.env`; nunca se incluyen en las capturas.

En producción, `npm run build` genera ambos workspaces y la API sirve `apps/web/dist` desde
el mismo origen, con fallback para rutas de React. Docker incluye ese build. El worker sigue siendo
un proceso independiente. Configurar HTTPS, `ALLOWED_ORIGINS` y `TRUST_PROXY` según el runbook.
Informe: [REPORTE_FRONTEND_P0.md](docs/implementation/REPORTE_FRONTEND_P0.md).

Los E2E reutilizan cookies de sesión solo en memoria por worker/proyecto. Si hay HTTP 429
al iniciar sesión, respetar Retry-After y esperar la ventana configurada; no desactivar
los límites ni limpiar sus contadores.

## Integración Gemini / Supabase

Preparación disponible; **servicios externos todavía BLOCKED**. Supabase CLI fijada en la raíz:
`npm run supabase -- login`, luego listar proyectos y vincular únicamente el destino de Blinka.
Gemini usa el perfil privado `.env.gemini`; comprobar recepción sin llamadas con
`npm run start:gemini-worker -w @blinka/backend -- --check-config`.
No arrancar procesos remotos antes de autorizar el destino: Graphile puede ejecutar DDL.
[Estado, evidencias, límites y siguientes comandos](docs/implementation/REPORTE_P0_INTEGRATION_GEMINI_SUPABASE.md).
La regresión aislada se ejecuta con `npm run build` y `npm run verify:mock` (FAKE/FIXTURE, solo PostgreSQL local, sin capturas).
