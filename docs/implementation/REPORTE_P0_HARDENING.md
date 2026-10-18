# P0-HARDENING — Seguridad financiera y evidencia documental

**Fecha:** 18-10-2026. **Alcance:** solo local. No se modificaron Supabase ni bases remotas, no se usó Gemini real y no hubo despliegue, commits ni push.

**Única integración real ejercida:** peticiones GET a la API pública de Frankfurter, sin credenciales, autorizadas explícitamente en el encargo.

## Resumen de madurez

- **Backend:** `LOCAL_MVP_READY`.
- **FX Frankfurter v2:** **verificado con peticiones reales** (USD/COP, COP/USD, EUR/USD).
- **Gemini, Supabase y Railway:** siguen `EXTERNAL_INTEGRATION_UNVERIFIED`. Las pruebas de IA usan el proveedor **FAKE (MOCK)**. Nada de este informe debe leerse como validación con servicios reales de IA, almacenamiento o despliegue.

## Resultados verificables

Evidencias en [`evidence/`](evidence/): `hardening-final-verification.txt`, `hardening-demo-compose.txt` y `frankfurter-v2-real.txt`.

| Verificación (desde `npm ci` limpio) | Resultado |
|---|---|
| `lint` · `typecheck` · `build` | OK |
| `npm test` (sin red) | **234/234** en 28 archivos (antes 199/199; +35 nuevas) |
| `npm run test:external` (red real, Frankfurter v2) | **3/3** |
| `npm audit --omit=dev` | 0 vulnerabilidades (las 4 moderadas siguen siendo solo de desarrollo: `drizzle-kit`) |
| Demo A–O en Docker Compose (API y worker en contenedores, Graphile real, BD local nueva) | 15/15 resultados esperados; 152 evidencias `TEXT_VERIFIED`, 1 `NOT_FOUND` (N), 11 `UNVERIFIABLE` (O); cron `recover_stale_runs` registrado; 0 secretos en logs |

Pruebas nuevas:
- `unit/evidence-verifier` (10).
- `integration/evidence` (5).
- `integration/hour-cap` (5).
- `integration/recovery` (6).
- `external/frankfurter` (3, fuera de `npm test`).
- Ampliaciones: `unit/decision-engine` (+5), `unit/fx` (reescrita para v2: 8) y demo E2E (+2 escenarios).

Migraciones nuevas: **0013–0016**:
- `0013`: ledger `contract_hour_consumptions`.
- `0014`: inmutabilidad del ledger.
- `0015`: `document_text_layers`, `document_text_pages`, `invoice_field_confirmations`, posición en `evaluation_evidence` y estados de evidencia.
- `0016`: inmutabilidad de capas de texto y confirmaciones.

## Trabajo 1 — Verificación de evidencias

**Estrategia:**
1. **Al subir** un documento se extrae su capa de texto de forma determinista con `unpdf` (pdf.js empaquetado, sin `new Function`, sin fuentes del sistema; límites de 50 páginas, 500 000 caracteres y 10 s). Se guarda **inmutable** con la huella del texto y la versión del extractor:
   - `TEXT`: PDF digital.
   - `NO_TEXT`: imagen o PDF escaneado.
   - `UNPARSEABLE`: PDF corrupto o fuera de límites.
2. En cada evaluación, **todo valor que usa el motor** se coteja con el texto del **original**, no con lo que reporta el modelo:
   - **Críticos:** número, total, moneda, fecha de emisión y cuenta de destino. La cuenta se coteja con el número concreto cuya huella coincidió con la cuenta del proveedor.
   - **Condicionales:** referencia de contrato, NIT del emisor, período de servicio, subtotal, impuestos y descuentos, y por línea: importe, precio, cantidad y referencia.
3. **Cotejo conservador:**
   - Identificadores por ventanas de palabras consecutivas: `FAC-0001` no verifica `FAC-001` ni `FAC-00011`.
   - Números sin ambigüedad decimal (`1,200.00`, `1.200,00`); los dígitos pegados a letras, `/` o `-` (fechas, NIT, códigos) no cuentan como importes.
   - El **total** exige contexto «TOTAL / A PAGAR» en la misma línea o en la anterior, para que el subtotal no lo verifique.
   - Moneda solo por código ISO o símbolo inequívoco: `$` a secas no prueba nada.
   - Fechas ISO, dd/mm/aaaa y con nombre de mes; nunca se reinterpretan como mm/dd.
4. Cada resultado se persiste en `evaluation_evidence` con **página, posición (`char_start/char_end`) y fragmento real**:
   - `TEXT_VERIFIED`: pasa.
   - `NOT_FOUND`: el documento tiene texto pero el valor no aparece (posible invento) → **EN_CORRECCION**.
   - `UNVERIFIABLE`: sin capa de texto → **EN_CORRECCION** hasta la corroboración humana.
   - `HUMAN_CONFIRMED`: pasa.
   
   Además, si falta la entrada de un campo crítico, el motor no autoriza (`EVIDENCE_MISSING`).
5. **Documentos escaneados o imágenes:** una persona autenticada revisa el original y confirma los campos (`POST /api/invoices/:id/versions/:versionId/confirmations`). La confirmación es auditada, ligada a la **versión actual y al valor**, y no se arrastra a versiones nuevas.
   - **No hay override:** en un PDF con texto, la confirmación se rechaza (`409 EVIDENCE_TEXT_AVAILABLE`); una discrepancia exige una versión corregida **con el documento que la respalde**.
6. Los fragmentos que **cita el modelo** también se cotejan: si no aparecen en el texto quedan `REJECTED`. En el E2E, el modelo citaba «Total USD 1,200.00» y el PDF dice «TOTAL A PAGAR: USD 1,200.00»: quedó `REJECTED`.

**Pruebas:**
- **Positivas:** factura conforme con 12 o más campos localizados en la página 1; total en la línea siguiente a su etiqueta.
- **Negativas e inventadas:** total, número, cuenta, referencia de contrato, fecha y moneda inventados → `NOT_FOUND` y `EN_CORRECCION` sin reserva; el subtotal no verifica el total; límites de palabra.
- **Escaneo:** confirmación parcial → sigue en corrección; confirmación completa → autoriza.
- **Sin override:** intento de confirmar en PDF con texto → 409; versión no actual → 409; otra empresa → 404.
- **Demo:** N (la IA reporta un total que no está en el documento) → `EVIDENCE_TOTAL_AMOUNT`; O (escaneada) → corrección, confirmación humana y después `AUTORIZADA`.

## Trabajo 2 — Límite acumulado de horas

- **Ledger `contract_hour_consumptions`:** una fila por factura **autorizada** (`UNIQUE(invoice_id)`), escrita **en la misma transacción** que la reserva e inmutable. Las versiones y las reentregas no cuentan dos veces.
- **Período aplicable:** el período **contractual** (mensual, trimestral o anual según `billing_frequency`) que contiene el **inicio del período de servicio**. Es independiente del **mes de autorización** presupuestaria; probado: servicio de septiembre autorizado en octubre → horas a `2026-09` y presupuesto a `2026-10`.
- **Regla:** horas previas autorizadas + horas de la factura ≤ tope. Si se excede → `EN_CORRECCION · HOURLY_CAP`, con el detalle «100 previas + 70 esta factura = 170 h (2026-10)». Sin período de servicio, o si este abarca dos períodos contractuales, va a corrección (`SERVICE_PERIOD_REQUIRED` / `SPANS`).
- **Concurrencia:** el orden de bloqueo pasa a ser **factura → contratos del proveedor (por id) → presupuesto global → categoría**. La suma de horas previas se lee bajo ese bloqueo.
- **Pruebas:**
  - Acumulación entre facturas (100+70 rechaza; 100+60 = 160 cabe; +1 rechaza).
  - Versiones (200 h rechazada y corregida a 100 h con documento → consumo 100).
  - **Carrera** de dos facturas de 100 h con tope 160 → exactamente una autorizada.
  - Reentrega → un único consumo.
  - Separación período de servicio / mes de autorización.

## Trabajo 3 — Frankfurter v2 y COP

**Diagnóstico con peticiones reales.** La implementación usaba **v1** con una lista fija de monedas BCE: `GET /v1/latest?base=USD&symbols=COP` devuelve **404**. Mi afirmación previa de que «Frankfurter no cubre COP» era **incorrecta**: valía solo para v1. En v2 los tres pares responden 200:

| Petición real | Respuesta |
|---|---|
| `v2/providers/BANREP/rate/USD/COP` | 3170.46 (2026-10-16, TRM del Banco de la República) |
| `v2/providers/BANREP/rate/COP/USD` | 0.00032 (solo 2 cifras significativas) |
| `v2/providers/ECB/rate/EUR/USD` | 1.1253 (2026-10-16) |
| `v2/rate/USD/COP` (combinada) | 3170.55 con fecha 2026-10-18: mezcla de proveedores, no una tasa oficial |

**Implementación:**
1. **Fuente explícita por moneda:** `FX_FRANKFURTER_SOURCES` (COP→BANREP, EUR/GBP/…→BCE). Si un par no tiene fuente, no se cotiza: **nunca** se usa la tasa combinada en silencio.
2. La tasa se lee del **texto JSON**, sin pasar por `number`.
3. **Precisión:** si la cotización llega con menos de 5 cifras significativas, se pide el par inverso a la **misma fuente y fecha** y se invierte con decimal exacto a 12 decimales (COP→USD = 1/3170.46 = 0.000315411644, frente a 0.00032 publicado: ≈1,5 % de diferencia). El método queda en `provider_reference`. Si la inversión no es fiable, el resultado es `INSUFFICIENT_PRECISION`, nunca una tasa inventada.
4. **Vigencia:** la fecha de publicación se toma de la fuente (los días hábiles del banco central) y la tasa vale `FX_MAX_AGE_HOURS` = 96 h, lo que cubre fines de semana y festivos. Pasado ese plazo → `ERROR` recuperable.
5. **Pruebas:** unitarias con `fetch` simulado (8) y una suite **externa separada** (`npm run test:external`, 3/3 reales), que comprueba estructura, fuente, rangos plausibles, coherencia COP/USD × USD/COP = 1 y frescura menor de 5 días.

La demo local sigue usando FIXTURE (simulada y rotulada) para ser reproducible sin red. Para usar tasas reales: `FX_PROVIDER=frankfurter`.

## Trabajo 4 — Recuperación automática

- Tarea `recover_stale_runs` (cron de Graphile cada 5 min, `maxAttempts=1`, una ejecución por tick aunque haya varios workers; registro verificado también en contenedor).
- Selecciona corridas `RUNNING` sin actividad durante `RECOVERY_STALE_MINUTES` (15) **y sin trabajo vivo** en la cola (pendiente, reintento programado o bloqueado recientemente). Con `FOR UPDATE SKIP LOCKED`, en una transacción:
  1. Marca las etapas huérfanas como `FAILED · ABANDONED`.
  2. Reencola `analysis_run` con clave única `analysis:<run>:recover:<n>`, junto a su evento de auditoría.
  
  Agotadas `RECOVERY_MAX_ATTEMPTS` (2), cierra la corrida como `ERROR · STALE_RUN`, sin decisión ni reserva y con reintento manual disponible.
- **Sin duplicados:** la recuperación nunca decide ni reserva. La reanudación reutiliza las etapas válidas por huella, y la decisión financiera es idempotente: estado de la corrida bajo bloqueo, `UNIQUE(invoice_id)` en reservas y en consumo de horas.
- **Pruebas:**
  - Caída a mitad de la extracción: reencolado, reanudación → `AUTORIZADA`; una reserva tras reentregas y nuevas pasadas.
  - Trabajo vivo → no se toca.
  - Agotamiento → `STALE_RUN`.
  - Dos recuperaciones simultáneas → un único reencolado.
  - Caída tras confirmar la decisión → solo se cierra la etapa huérfana.
  - Registro real del cron.

**Defecto real detectado en Compose y corregido:** la etapa `FINANCIAL_DECISION` se marcaba completada **después** de la transacción de la decisión, y el polling podía mostrar una corrida terminada con la etapa aún `RUNNING`. Ahora se cierra dentro de la misma transacción; las escrituras posteriores son condicionales. Verificado: 0 casos en la demo en contenedores.

**Corrección de medición:** la primera vez, `npm test` también ejecutaba la suite externa con red (y contaba 237). Se excluyó en `vitest.config.ts`; las cifras correctas son 234 + 3.

## Riesgos residuales

1. **Escaneos sin OCR:** dependen de la corroboración humana. Un OCR (o Gemini multimodal como segunda opinión) podría reducir el trabajo, pero no es determinista y no debería sustituir la regla.
2. **Presencia frente a semántica:** salvo el total (que exige contexto), se verifica que el valor **aparezca** en el documento, no su rótulo. Un número de factura citado en otro lugar (p. ej. «sustituye a FAC-001») verificaría ese campo; el control de duplicados sigue aplicando.
3. **Descuentos negativos pegados** (`-50.00`) no se reconocen como importes: el resultado es una corrección, conservadora pero con fricción.
4. **La extracción de texto ocurre en la petición de subida.** Hay límites, pero el *timeout* no interrumpe pdf.js. Con carga real, conviene moverla al worker.
5. **El texto completo de los documentos se guarda en BD.** Para producción: cifrado en reposo y política de retención.
6. **Recuperación:** si un worker «muerto» reaparece tras perder su bloqueo, la corrida podría ejecutarse dos veces en paralelo. No habría doble autorización (idempotencia probada), pero sí un posible coste de IA duplicado.
7. **Frankfurter:** servicio público sin SLA. BANREP publica en días hábiles colombianos, de modo que la TRM del viernes cubre el fin de semana. No hay proveedor de respaldo configurado.
8. **Tope de horas:** se computa por **contrato**; si una versión nueva del contrato cambia el tope a mitad de un período, se aplica el de la versión seleccionada.

## Requisitos pendientes para integrar servicios reales (sin activar nada antes de tu autorización)

- **Gemini:**
  - `GEMINI_API_KEY` con cuota y autorización de gasto, y el modelo elegido.
  - Probar con 3–5 PDF reales y algún escaneo: calidad de extracción, tasa de `NOT_FOUND` (inventos detectados), tokens y coste.
  - Validar *function calling* combinado con salida JSON.
- **Supabase:**
  - Proyecto, CA raíz (`DATABASE_SSL=verify-full`) y dos roles: propietario para `db:migrate` (con `REMOTE_DB_CONFIRM`) y de ejecución sin DDL.
  - Conexión de sesión (5432) para el worker.
  - Extensión `btree_gist`.
  - Bucket privado y `SUPABASE_SERVICE_ROLE_KEY` solo en servidor.
- **Railway:**
  - Proyecto con dos servicios (`deploy/railway/*.json`), variables del RUNBOOK §6 (incluidas `RECOVERY_*` y `FX_FRANKFURTER_SOURCES`) y salida HTTPS a `api.frankfurter.dev`.
  - Dominio común para frontend y API, por las cookies `SameSite=Strict`.
- **GitHub:** autorización de commit/push para ejecutar `.github/workflows/backend-ci.yml`. Corre `npm test` sin red; `test:external` puede añadirse como job separado.
