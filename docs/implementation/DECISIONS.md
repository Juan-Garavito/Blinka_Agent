# Decisiones técnicas (registro)

| ID | Decisión | Motivo |
|---|---|---|
| D-001 | Monorepo npm workspaces `apps/backend`, `apps/web` (reservado) | Aprobado por el usuario tras B0 |
| D-002 | Argon2id con `node:crypto` (Node ≥ 24.7), formato PHC | Sin dependencias nativas; API estándar de Node |
| D-003 | Sesiones en PostgreSQL (`auth_sessions`); cookie con token aleatorio, BD guarda SHA-256 | Sesión no en RAM; lectura de BD no permite suplantar |
| D-004 | CSRF por capas: Origin/Sec-Fetch-Site + cuerpo JSON obligatorio + token sincronizador por sesión + SameSite=Strict | Defensa en profundidad |
| D-005 | Contexto de empresa: cabecera `X-Company-Id` opcional, validada contra membresía activa; sin cabecera se usa la única membresía | Nunca confiar en company_id del cliente |
| D-006 | Rate limiting con almacén PostgreSQL (`rate_limit_buckets`) | Compartido entre instancias (criterio D) |
| D-007 | `DATABASE_SSL`: disable / require (cifra sin verificar) / verify-full (+CA opcional); producción remota exige verify-full | Corrección solicitada tras B0 |
| D-008 | `MIGRATION_DATABASE_URL` (aprovisionamiento, DDL) separada de `DATABASE_URL` (ejecución) + registro JSONL de operaciones | Separación aprovisionamiento/ejecución |
| D-009 | Techo de reintentos `MAX_TASK_ATTEMPTS=5`; el worker descarta intentos por encima del declarado | Evitar 25 reintentos (coste IA) |
| D-010 | Decisiones del motor `AUTHORIZE/BLOCK/ESCALATE`; ESCALATE → EN_APROBACION o EN_CORRECCION; ERROR técnico sin decisión; RECHAZADA solo humana | Convención fijada por el usuario + ER v1.2 |
| D-011 | Seeds solo locales: rechazados con host remoto aun con REMOTE_DB_CONFIRM, y en producción | Doc 01: un valor de entorno antiguo no sustituye consentimiento |
| D-012 | Los CHECK sobre columnas anulables usan `coalesce(..., false)` | Un CHECK que evalúa NULL se acepta en PostgreSQL (bug real detectado en B1) |
| D-013 | `OPS_AUDIT_FILE=stdout` en la imagen Docker | Contenedor efímero y sin disco escribible; logs de plataforma = registro persistente |
| D-014 | FKs compuestas `(company_id, id)` en todas las tablas empresariales; `company_id` añadido a `contract_versions` e `invoice_versions` | ER §5.1: impedir asociaciones entre empresas en la BD |
| D-015 | Duplicado confirmado: la factura se registra con `duplicate_of_invoice_id` y SIN identidad (UNIQUE parcial) | Permite registrar y BLOQUEAR (FIN-02) en vez de rechazar la carga |
| D-016 | Inmutabilidad por triggers (documents, invoice_versions, invoice_lines, audit_events; contract_versions/items fuera de DRAFT) | Historia auditable no sobrescribible |
| D-017 | EXCLUDE (btree_gist) de vigencias CONFIRMED por contrato | Selección de versión por fecha determinista |
| D-018 | Cuentas: HMAC-SHA256(ACCOUNT_FINGERPRINT_SECRET) + máscara; nunca el número | Una filtración de BD no revela cuentas |
| D-019 | Subida binaria (body = archivo, `X-File-Name`), PDF/PNG/JPEG por magic bytes; XML no soportado | Sin parser multipart; tipos no simples para CORS |
| D-020 | Importes en API solo como strings decimales; dinero NUMERIC(20,4), precios NUMERIC(20,6) | Nunca float |
| D-021 | Serializador de errores de pino: de errores de BD solo código/restricción | DrizzleQueryError incluye parámetros en el mensaje |
| D-022 | Motor = función pura `decide()`; evaluación final en UNA transacción con locks factura → presupuesto global → categoría; FX fuera de la transacción | Revalidación y concurrencia por construcción (FIN-21..24) |
| D-023 | Precedencia BLOCK > ERROR > EN_CORRECCION > EN_APROBACION > AUTORIZADA | Bloqueo verificado prevalece; un ERROR impide conclusiones financieras |
| D-024 | Efecto ENABLEMENT (proveedor/cuenta PENDING o cuenta no registrada) → EN_APROBACION sin solicitud de aprobación de importe | FIN-07: aprobar la factura no basta |
| D-025 | Sin política COMPANY vigente o hueco/ambigüedad de matriz → EN_CORRECCION (configuración) | No se supone aprobador |
| D-026 | Reserva redondeada hacia arriba a 4 decimales en moneda base | Nunca reservar de menos |
| D-027 | Frankfurter (BCE) sin COP; proveedor FIXTURE simulado por defecto en dev/test; producción exige FX_ALLOW_SIMULATED=true para usar fixture | Honestidad: tasas simuladas rotuladas |
| D-028 | `invoice_attachments` (adición física): TIMESHEET exigido en HOURLY, MILESTONE_ACCEPTANCE en MILESTONE | ER exige respaldo/aceptación por modalidad |
| D-029 | Corrida concurrente o reentregada sobre factura ya autorizada → SUPERSEDED (no AUTHORIZE sin reserva propia) | Trigger diferido: AUTHORIZE ⇒ reserva vinculada |
| D-030 | Un solo especialista LLM (extractor+clasificador); búsqueda y validación contractual deterministas; decisión siempre en `decide()` | ARCH-007: IA solo donde aporta valor; coste por factura = 1 llamada |
| D-031 | Huella de extracción = documento (id+SHA-256) + versión de prompt + proveedor + modelo; reutilización a nivel empresa | AG-02/03: no repetir IA con insumos idénticos |
| D-032 | FINANCIAL_DECISION nunca se reutiliza; FX caído reintentable hasta el último intento, luego ERROR | ER: resultados financieros siempre recalculados |
| D-033 | Documento rechazado por el proveedor (INVALID_DOCUMENT) o UNREADABLE/NOT_INVOICE → EN_CORRECCION (EXTRACTION_QUALITY) sin reintentos | AG-07 |
| D-034 | Evidencia de extracción = MODEL_REPORTED (sin parser PDF en P0); nunca basta para autorizar | Honestidad sobre verificación |
| D-035 | La API inserta trabajos (makeWorkerUtils perezoso) con jobKey por corrida; rate limit por empresa (PG) + tope de análisis pendientes | AG-11, sin gasto descontrolado |
| D-036 | Proveedor FAKE (MOCK) por defecto en dev/test; en producción exige AI_ALLOW_FAKE=true; coste estimado 0 si simulado | No presentar mock como IA real |
| D-037 | approval_requests con invoice_version_id + amount_base y estado SUPERSEDED (adiciones al ER) | Una aprobación no se reutiliza si cambia la factura o el importe (FIN-24/25) |
| D-038 | APPROVE nunca autoriza directamente: dispara evaluación determinista nueva en el mismo trámite | FIN-25 / criterio B5 |
| D-039 | REJECT crea corrida RECHAZADA (decision null) y cierra el trámite; reintento posterior abre trámite nuevo con previous_flow_id | ER: flujos terminados no se reescriben |
| D-040 | EN_CORRECCION, BLOQUEADA y habilitaciones (ENABLEMENT) no generan solicitudes: no existe "aprobar de todos modos" | Criterio B5 |
| D-041 | **Corrección de D-027**: Frankfurter **v2** sí cubre COP (verificado con GET reales 18-10-2026); la limitación era de v1. Migrado a v2 | Diagnóstico con peticiones reales (evidence/frankfurter-v2-real.txt) |
| D-042 | FX con fuente EXPLÍCITA por moneda (`/v2/providers/{fuente}/rate`): COP→BANREP (TRM), resto→BCE; nunca la tasa combinada de varios proveedores; par sin fuente → no se cotiza | Trazabilidad a un banco central concreto |
| D-043 | Tasa leída del texto JSON; si llega con < 5 cifras significativas (COP→USD = "0.00032", error ≈1,5 %), se invierte el par opuesto de la misma fuente y fecha con decimal exacto (12 decimales) y se registra el método | Precisión financiera |
| D-044 | Pruebas de red real separadas (`test:external`, excluidas de `npm test`) | Suite principal reproducible sin red |
| D-045 | Dependencia `unpdf` (MIT, sin dependencias, pdf.js sin `new Function`) para la capa de texto; descartado `pdfjs-dist` (35 MB, binario nativo opcional) | Verificación determinista de evidencias |
| D-046 | Capa de texto extraída al subir el documento y guardada inmutable (`document_text_layers/pages`); TEXT / NO_TEXT / UNPARSEABLE | Reproducibilidad de cada evidencia |
| D-047 | Todo valor usado para decidir debe estar en el documento original (TEXT_VERIFIED) o confirmado por persona si no hay capa de texto (HUMAN_CONFIRMED). NOT_FOUND/UNVERIFIABLE ⇒ EN_CORRECCION; campo crítico sin entrada ⇒ EVIDENCE_MISSING | "No autorizar con evidencia faltante o discrepancia" |
| D-048 | Cotejo conservador: identificadores por ventanas de palabras (límites de palabra); números sin ambigüedad decimal; "$" solo no prueba moneda; total exige contexto TOTAL/A PAGAR; fechas dd/mm (no mm/dd) | Minimizar falsos positivos de verificación |
| D-049 | Confirmación humana SOLO para documentos sin capa de texto, ligada a versión y valor; en PDF con texto, una discrepancia exige corrección (409 EVIDENCE_TEXT_AVAILABLE) | Sin override de discrepancias |
| D-050 | Ledger `contract_hour_consumptions` (UNIQUE invoice) en la transacción de la reserva; período = período CONTRACTUAL que contiene el inicio del servicio; lock de contratos del proveedor (factura → contratos → presupuestos) | Tope acumulado sin doble conteo ni carreras |
| D-051 | Recuperación automática: cron Graphile `recover_stale_runs` (5 min); reencola corridas RUNNING sin actividad y sin trabajo vivo, cierra etapas huérfanas (ABANDONED), máx. 2 recuperaciones ⇒ ERROR STALE_RUN | Recuperación sin decisiones ni reservas nuevas |
| D-052 | La etapa FINANCIAL_DECISION se cierra dentro de la transacción de la decisión | Polling consistente (defecto real observado en Compose) |

| D-053 | React + Vite + JavaScript en workspace `@blinka/web`; rutas/pestañas/filtros direccionables, polling con cancelación y estados técnicos separados de decisiones | Frontend P0 |
| D-054 | Navegador same-origin: proxy Vite en desarrollo y Express sirve el build en producción; API desconocida conserva 404 JSON; HTML sin caché persistente, assets con hash inmutables | Sesiones HttpOnly y CSRF sin CORS |
| D-055 | Evidencia resalta rangos reales `[charStart,charEnd)`; citas del modelo se distinguen de verificación; solo documentos sin texto permiten confirmación humana auditada y reanálisis | Sin override de discrepancias |
| D-056 | Banner móvil compacto con detalles desplegables; mantiene visibles demo, ausencia de pagos reales e IA/FX simulados | Espacio útil en teléfonos |
| D-057 | Lista de aprobaciones incluye proveedor y número de la versión solicitada mediante joins por empresa; se elimina el cruce limitado a 100 facturas | Identidad consistente con cualquier volumen |
| D-058 | Configuración de empresa permanece de solo lectura porque no existe endpoint de edición; E2E usa servicios locales reales e IA/FX simulados | Alcance verificable sin integraciones externas |

| D-059 | Gemini real tiene perfil separado y smoke aislado con máximo 10 solicitudes incluyendo listado y tres facturas ficticias; corte ante cualquier error y sin retries | Control de gasto y conservación de MOCK offline |
| D-060 | Gemini 3.8 Flash fijado según documentación estable; acceso real debe confirmarse por API. Tokens de pensamiento se suman a salida y firmas se conservan solo en memoria | Protocolo y costes trazables, servicio todavía BLOCKED |
| D-061 | Supabase CLI 2.121.0 en raíz, migraciones/seed CLI deshabilitados; Drizzle conserva tablas de negocio | Evitar dos administradores de migraciones |
| D-062 | Preflight usa conexión READ ONLY y TLS verify-full remoto. API makeWorkerUtils y worker comparten guardia remota por posible DDL Graphile; transaction pooler rechazado | No escribir esquema remoto al probar conectividad |
| D-063 | Roles/RLS/bucket privados preparados con plan por defecto, --apply y confirmación exacta solo después de autorización humana; ninguna escritura remota ejecutada | Separar inspección de aprovisionamiento |
| D-064 | Regresión E2E en base local aislada, FAKE/FIXTURE explícitos y navegador sin solicitudes externas; CI no genera capturas de interfaz | Preservar datos manuales y alcance de integración |
