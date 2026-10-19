# 04 · Operación

Tareas habituales una vez que **Blinka FacturAction** está en marcha. Referencia completa de incidencias en [`docs/implementation/RUNBOOK.md`](../implementation/RUNBOOK.md).

## Comandos de un vistazo

| Necesito… | Comando |
|---|---|
| Analizar muchas facturas | `npm run analyze:batch -- [opciones]` |
| Saber cuánto gasta la IA | `npm run ai:cost -w @blinka/backend` (local) · `npm run ai:cost:supabase -w @blinka/backend` |
| Ver métricas de negocio | Interfaz → **Operaciones → Negocio y ROI** · `GET /api/business-metrics` |
| Arrancar todo contra Supabase + Gemini | `REMOTE_DB_CONFIRM=<host>/<base> npm run start:cloud` |
| Producción con HTTPS | `npm run prod:up` · `prod:logs` · `prod:down` |
| Comprobar la conexión remota (solo lectura) | `npm run integration:preflight` |
| Exportar el contrato de la API | `npm run openapi:export` |
| Auditar el repo antes de publicarlo | `npm run security:public` |

## Análisis masivo encolado

`analyze:batch` encola facturas **por la API** (misma ruta que la interfaz: sesión, CSRF, auditoría y cola), mantiene un número acotado de análisis en curso, sigue cada uno hasta su resultado y al final muestra la tabla y el **gasto de IA del lote**.

```bash
npm run analyze:batch -- --dry-run                      # qué analizaría, sin hacer nada
npm run analyze:batch                                   # pendientes y en error (API en :4003 por defecto)
npm run analyze:batch -- --select=all --parallel=5      # todas, incluidas las ya decididas
npm run analyze:batch -- --api=http://127.0.0.1:4000 --select=error,correction --limit=20
```

| Opción | Valores |
|---|---|
| `--select` | `pending` (sin evaluar), `error`, `correction`, `all`; combinables con coma |
| `--parallel` | 1–10 análisis simultáneos en la cola (por defecto 5) |
| `--limit` | Máximo de facturas |
| `--api` | API en este equipo (`http(s)://localhost` o `127.0.0.1`) |

Respeta los límites de la API (10 pendientes por empresa, 60 por hora): ante `429` espera 30 s y reintenta. El ritmo real lo marca el worker: `WORKER_CONCURRENCY` (trabajos simultáneos) y `AI_MAX_CONCURRENCY` (llamadas simultáneas al modelo). Con Gemini, cuenta con unos 20–40 s por factura.

## Coste de la IA

Cada llamada al modelo se registra en `ai_usage_logs` con proveedor, modelo, tokens de entrada y salida (incluido el pensamiento), latencia, estado y **coste estimado** con el precio de lista configurado (`AI_PRICE_INPUT_USD_PER_MTOK` / `AI_PRICE_OUTPUT_USD_PER_MTOK`). Tres formas de consultarlo:

1. **Auditoría → Uso de IA:** panel con filtro de fechas: total, coste medio por análisis y desglose por etapa (con reintentos), modelo, día y factura; debajo, el detalle por llamada.
2. **Dashboard:** total por proveedor en el panel «Uso de IA».
3. **Terminal:** `ai:cost` / `ai:cost:supabase` (`-- --since=YYYY-MM-DD`), solo lectura.

Referencia con Gemini 4 Argon: **≈ 0,038 USD por análisis completo**. Es una estimación de lista: la API de Gemini no expone la factura real.

**Tope opcional de gasto.** Si defines a la vez `AI_MAX_REQUESTS_PER_PROCESS` y `AI_MAX_COST_USD_PER_PROCESS`, cada worker deja de llamar al modelo al alcanzarlos y las facturas siguientes quedan en *Error técnico · Tope de gasto de IA del proceso alcanzado* (no es un bloqueo financiero). Por defecto está desactivado para medir el coste completo.

## Métricas de negocio y ROI

`Operaciones → Negocio y ROI` (o `GET /api/business-metrics?period=YYYY-MM&reviewMinutes=15&analystHourlyUsd=12.00`) devuelve, por mes en la zona horaria de la empresa:

- **Hechos medidos:** recibidas, con decisión, % resueltas sin intervención humana, volumen autorizado (simulado), importe frenado, pendientes de una persona.
- **Coste de IA estimado** y coste por análisis.
- **Ahorro y ROI hipotéticos** a partir de los supuestos indicados.

Cada métrica incluye `definition`, `denominator` y `source`; las hipotéticas llevan `hypothetical: true`. Fórmulas en la [guía de producto](01-producto.md#negocio-y-roi-cómo-leer-las-cifras).

## Recuperación y reintentos

| Situación | Qué ocurre / qué hacer |
|---|---|
| Fallo transitorio (red, 429, 5xx, tiempo) | La cola reintenta hasta 3 veces; solo se repite la etapa que falló y la extracción válida se reutiliza |
| Fallo permanente | La factura queda en **Error técnico** con su código; **Reintentar análisis** es seguro |
| Corrida atascada | El cron `recover_stale_runs` (cada 5 min) cierra etapas huérfanas y la reencola (máx. 2) o la cierra como `STALE_RUN` |
| Datos incorrectos | Corregir con una **nueva versión** desde el expediente (las anteriores no se modifican) |
| Documento escaneado | Confirmar campos en **Evidencia** (queda auditado) y reanalizar |
| Muchas facturas en error | `npm run analyze:batch -- --select=error` |

## Gestión diaria

- **Proveedores:** nacen *pendientes de habilitación*; habilitar o bloquear exige motivo y queda auditado. Las cuentas bancarias se guardan como huella HMAC + máscara.
- **Contratos:** cada versión se confirma explícitamente antes de usarse para decidir; las vigencias no pueden solaparse.
- **Políticas:** versiones inmutables con límite de autorización automática, tope absoluto y matriz de aprobación (personas simuladas).
- **Presupuestos:** límite mensual global y por categoría en moneda base; no se puede bajar por debajo de lo reservado.

## Pruebas

```bash
npm run lint && npm run typecheck && npm run build
npm run db:migrate:test && npm test        # unitarias + integración (PostgreSQL y Graphile reales)
npm run e2e                                # Playwright: recorrido completo, aprobaciones, escaneados, responsive
npm run test:external                      # opcional, con red: Frankfurter v2 real
npm run verify:mock                        # E2E aislado con IA simulada en una base local dedicada
```
