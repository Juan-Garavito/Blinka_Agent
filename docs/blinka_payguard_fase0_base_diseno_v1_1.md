# Blinka PayGuard AI — Cierre de bloqueantes para iniciar diseño

**Proyecto:** Hackaton 30X — Reto Blinka «Agentes que pagan por la empresa»  
**Fase:** 0, base de diseño funcional y de arquitectura  
**Versión:** 1.1 · 17 de octubre de 2026 (revisión de rechazo, divisas y asociación contractual)  
**Convención:** «CONFIRMADA» refleja decisiones expresas del usuario en el cuestionario. «DEFAULT DE DISEÑO» es una propuesta cerrada para elaborar el diseño, revisable por el usuario; no se presenta como confirmación histórica.

## 1. Resultado ejecutivo

El MVP es un **agente de cuentas por pagar (AP) para empresas** que recibe facturas, extrae datos y evidencia, contrasta contratos y políticas empresariales, y emite uno de tres resultados: **AUTORIZAR, BLOQUEAR o ESCALAR**. Una autorización crea una **reserva presupuestaria simulada y atómica**; no se realiza ningún pago real. Deben conservarse decisiones, entradas, reglas y evidencias para auditoría y demo.

**Dictamen:** listo para iniciar diseño UX, modelo de datos, APIs y arquitectura. Las reglas *confirmadas* se distinguen de las *propuestas de diseño*; dichas propuestas son revisables sin detener el diseño. Los umbrales comerciales se configurarán como datos de demo y no como constantes del producto.

## 2. Decisiones funcionales confirmadas

| ID | Regla confirmada |
|---|---|
| BR-001 | Cada empresa tiene un tope **absoluto por factura**. Si se supera, BLOQUEAR; la aprobación humana ordinaria no puede ignorarlo. Existe otro límite inferior de autorización automática: si se supera este y no el absoluto, ESCALAR. |
| BR-002 | Proveedor o cuenta de destino **expresamente bloqueados** -> BLOQUEAR. Nuevos/no autorizados -> ESCALAR y autorizar explícitamente el proveedor y/o la cuenta antes de reevaluar. |
| BR-003 | Políticas globales, categoría, contrato y proveedor son acumulativas; una regla particular solo puede endurecer las globales. |
| BR-004 | Ausencia de contrato o acuerdo registrado aplicable -> ESCALAR; nunca autorizar automáticamente. |
| BR-005 | Discrepancia contractual -> ESCALAR explicando el campo; solo se resuelve con documento corregido o evidencia verificable de acuerdo válido; no basta una excepción humana informal. |
| BR-BUD-001 | Presupuesto **mensual global y mensual por categoría**; ambos deben cumplirse. |
| BR-VEN-001 | Proveedor con varias cuentas bancarias, cada una con moneda, país y autorización independiente; sin beneficiarios terceros en MVP. |
| BR-CON-001 | Plantillas para recurrentes, horas, entregables y órdenes de compra; captura manual o extracción IA **confirmada por humano antes de activarse**. Un proveedor puede tener varios acuerdos. |
| BR-INV-001 | Extracción de proveedor, número externo, importe total, **moneda obligatoria**, emisión, vencimiento, destino, conceptos, cantidades, tarifas y subtotales; comparación con acuerdo aplicable. |
| BR-BUD-002 | Autorización automática o humana -> reserva presupuestaria simulada **atómica**; factura escalada no reserva; reevaluación completa antes de autorizar. |
| BR-AUD-001 | Evaluaciones e historial inmutables con evidencias y versiones de factura, acuerdos, políticas, decisiones y reservas; sin Event Sourcing integral. |
| BR-INV-VER-001 | ID interno de factura estable, múltiples versiones documentales y de datos; nuevas evaluaciones por cambio de versión o contexto, ligadas a versiones exactas. No sobrescribir resultados previos. |
| BR-WFL-002 | En aprobación se resuelve aprobación/rechazo humano; en corrección se aportan documento/evidencia/datos; tras corrección hay reevaluación. |
| BR-WFL-003 | Tras bloqueo puede abrirse **otro flujo de evaluación relacionado con la misma factura**, únicamente con un cambio verificable; el flujo bloqueado original queda intacto. No duplicar obligaciones ni autorizaciones. |
| BR-WFL-004 | La solicitud En aprobación permanece pendiente hasta respuesta, sin caducidad automática; reevaluar reglas y presupuesto antes de autorizar. |

**Estados visibles revisados:** `EN_APROBACION`, `EN_CORRECCION`, `BLOQUEADA`, `RECHAZADA`, `AUTORIZADA`, `ERROR`. La separación explícita de `RECHAZADA` y `BLOQUEADA` **sí fue confirmada por el usuario**; las primeras cinco etiquetas se mantenían con la aclaración de separación. `RECIBIDA` y `PROCESANDO` son fases técnicas, no estados finales. Las tres decisiones del agente son `AUTHORIZE`, `BLOCK`, `ESCALATE`: `RECHAZADA` es **resolución humana**, no un `BLOCK` automático; `ERROR` es falla técnica.

## 3. Decisiones por defecto para cerrar asuntos pendientes del P0

### D-01 — Rechazo humano, retirada y anulación

**CONFIRMADO:** `RECHAZADA` es estado propio, diferente de `BLOQUEADA`. Solo una **persona aprobadora simulada** rechaza una solicitud `EN_APROBACION`: evento inmutable `HUMAN_REJECTED`, actor, fecha, motivo y contexto. No se presenta como infracción financiera ni crea reserva. `BLOQUEADA` se usa para prohibición dura comprobada por políticas, con códigos propios.

**CONFIRMADO:** No se anulan autorizaciones en P0; por tanto, no hay liberación/reversión de reservas de una factura ya autorizada. La autorización permanece en la simulación y no debe alterarse silenciosamente.

**PROPUESTA DE DISEÑO:** Excluir `RETIRAR SOLICITUD` de P0. Retirar sería que el usuario deje voluntariamente de tramitar una factura que aún está `EN_APROBACION` o `EN_CORRECCION`, distinto del rechazo del aprobador; requeriría un estado/resolución aparte. No aparece botón de retirar en la demo. Puede implementarse después con estado `RETIRADA` y motivo auditable, sin confundirlo con bloqueo o rechazo.

### D-02 — Periodo y funcionamiento de presupuestos

- Cada empresa tiene **moneda base**, zona horaria y categorías. Presupuestos global y por categoría se expresan en la moneda base.
- Para el MVP, la reserva se imputa al **mes local de autorización simulada**; no al de emisión, vencimiento ni prestación. Se muestra esa regla explícitamente en la UI. No hay traslado automático de saldo entre meses.
- La reserva se crea en una sola operación transaccional/idempotente después de verificar saldo **global y de categoría**, con locking o equivalente para impedir carreras; ambas deducciones ocurren juntas o ninguna.
- Los presupuestos de un mes activo se configuran antes del primer uso y **no se amplían a través de una excepción informal durante la demo**. Un proceso formal de modificación es P1. El insuficiente saldo en cualquiera de los dos niveles es bloqueo duro.
- Una obligación autorizada y reservada no puede reservarse de nuevo, ni por un flujo alternativo ni por una nueva carga del mismo archivo.

### D-03 — Multimoneda por empresa y controles FX

**SOLICITADO POR EL USUARIO / PROPUESTA CONCRETA DE DISEÑO:** cada empresa configura una `base_currency` propia (no USD fijo en todo el producto). Para la empresa ficticia principal sugerimos `USD`; el catálogo P0 puede admitir `USD`, `COP`, `EUR` como demostración. Un presupuesto global mensual, un presupuesto por categoría y los topes de autorización automática/absoluta de esa empresa se expresan en **su moneda base**. Las facturas conservan su `invoice_currency` nativa independiente del país del proveedor.

**Algoritmo financiero:** extraer el importe y moneda nativos, validar sus datos y relación contractual; obtener tasa FX confiable **del catálogo de demo, no del modelo de IA**, para convertir a moneda base antes de evaluar topes y ambos presupuestos. Ejemplo: empresa base USD, factura COP 4.000.000, tasa simulada 1 USD = 4.000 COP, exposición US$1.000. Si presupuesto restante US$900 -> `BLOQUEADA`. Tasa y cifras se marcan como **simuladas**; no son cotizaciones bancarias reales.

**Auditoría:** cada evaluación registra `invoice_currency`, `invoice_amount`, `base_currency`, `rate_pair`, `fx_rate`, instante/versión/fuente, `converted_amount` y reglas de precisión/redondeo decimal. La autorización vuelve a verificar la tasa de referencia vigente y fija un snapshot único para su reserva atómica. Misma moneda -> tasa 1. Redondear conservadoramente al reservar para no exceder topes por precisión.

**Faltantes:** moneda nativa desconocida/ambigua, o tasa ausente en el catálogo -> `EN_CORRECCION` por información/configuración no verificable; fallo técnico del servicio -> `ERROR`. Nunca inventar FX ni aprobar sin conversión necesaria.

**Importante:** conversión a moneda base para **control presupuestario**, no ejecución ni liquidación transfronteriza. La coincidencia factura-contrato se valida en moneda nativa cuando coinciden; diferencia de monedas necesita condición contractual de conversión expresa y evidencia o, en P0, se escala a `EN_CORRECCION`. Verificar que la cuenta bancaria esté autorizada y sea compatible con la moneda de pago pretendida; no simular capacidades de FX bancario no implementadas.

**DEFAULT AÚN REVISABLE:** las reservas se imputan al mes local de autorización simulada, sin arrastre entre meses (definido en D-02). No reabrimos los límites presupuestarios previamente confirmados.

### D-04 — Datos de factura y asociación a contrato: estrategia híbrida recomendada

**CONFIRMADO:** una factura posee empresa/proveedor, número externo, total, **moneda obligatoria**, fechas, cuenta destino y líneas con conceptos/cantidad/precios/subtotales; se contrasta contra contrato o acuerdo registrado aplicable. Un proveedor puede registrar varios acuerdos (recurrentes, horas, entregables, OC). Si falta contrato aplicable, NO autorizar.

**RECOMENDACIÓN FUNCIONAL:** asociar primero la factura al **proveedor validado** y dejar que el agente proponga/encuentre el **contrato correcto** en el conjunto de contratos de ese mismo proveedor. No confiar ciegamente en que una selección manual sea correcta y no dejar que una IA vincule un contrato sin evidencia.

1. Identificar proveedor; verificar identidad y beneficiario/autorización por separado.
2. Recuperar contratos de ese proveedor potencialmente vigentes para fecha/período de factura (por `company_id`, `vendor_id`).
3. Comparar indicios como número de OC/acuerdo, descripción/conceptos, moneda, fechas, tarifas, hitos/cantidades. La IA puede interpretar lenguaje o sugerir candidatos, pero no inventar correspondencias.
4. **Vínculo automático solo si hay coincidencia inequívoca respaldada por evidencias**, con regla explicable y un contrato compatible. Si hay cero, múltiples o coincidencia débil -> `EN_CORRECCION`: presentar candidatos y pedir evidencia o corrección/selección asistida.
5. **Si el usuario selecciona manualmente un contrato, la asociación es una propuesta, NO prueba de validez**: el motor comprueba proveedor, vigencia, moneda, conceptos, importes y otros términos. Una asociación equivocada no se acepta para autorizar; se devuelve a corrección.
6. P0, una factura se imputa a **un acuerdo y una categoría** después de verificar el vínculo. Facturas que mezclan varios contratos/categorías -> `EN_CORRECCION` y resolución documental; reparto real entre contratos es P1.

**Plantillas:** recurrente (importe/periodicidad/vigencia); horas (tarifa, horas, máximo y evidencia); entregables (hito, importe, evidencia de aceptación); OC (ítems/cantidades/precios). Condiciones extraídas por IA requieren **confirmación humana antes de activar** un contrato. No inventar aceptación de servicios.

**Auditoría:** cada evaluación captura contrato/candidato(s), razón de selección o de ambigüedad, identificador de versión y evidencia exacta. La mera similitud del monto **no basta** para deducir un contrato. Capturar impuestos/descuentos para conciliar total sin motor tributario avanzado. Sin notas crédito ni pagos parciales P0.

### D-05 — Duplicados e identidad estable

- ID interno estable `invoice_id`; archivos/datos en `invoice_versions`; cada intento en `evaluation_runs`, opcional `previous_evaluation_id` o `related_flow_id`.
- Índices y comprobaciones por `company_id + vendor_id + external_invoice_number` y huella de archivo/contenido; una coincidencia concluyente de obligación duplicada **ya autorizada o previamente identificada** -> BLOQUEAR. Coincidencia dudosa -> `EN_CORRECCION` hasta resolver con evidencia.
- Una corrección modifica la **versión vigente**, no la identidad; si la factura ya se autorizó, otra versión no debe crear una nueva autorización de la misma obligación.
- Un **nuevo flujo tras bloqueo** requiere un cambio acreditado; conserva tanto la evaluación inicial como las siguientes y revalida todas las reglas. No cambia retrospectivamente el estado del flujo original.

### D-06 — Resolución determinista, estados y seguridad

- Resultados automáticos del motor: **`BLOCK`** si hay prohibición dura comprobada; de lo contrario **`ESCALATE / EN_CORRECCION`** por datos, evidencia, contrato o FX insuficientes; si no **`ESCALATE / EN_APROBACION`** por aprobación requerida, proveedor/cuenta por autorizar; de lo contrario **`AUTHORIZE / AUTORIZADA`** cuando todo pasa y la reserva atómica queda registrada. Registrar *todos* los hallazgos, además del predominante.
- `RECHAZADA` no es decisión del motor: solo una resolución humana explícita de una solicitud `EN_APROBACION` con actor/motivo/timestamp. Queda registrada sin usar reason code de bloqueo automático.
- Estados operativos visibles **seis**: `EN_APROBACION`, `EN_CORRECCION`, `BLOQUEADA`, `RECHAZADA`, `AUTORIZADA`, `ERROR`. Fallos técnicos -> `ERROR` y reintentos seguros, sin emitir aprobación o rechazo de política.
- Son bloqueos duros: máximo absoluto, presupuesto insuficiente, cuenta/proveedor expresamente bloqueados, obligación duplicada confirmada. Ningún aprobador puede ignorarlos.
- El LLM extrae/propone datos y correspondencias contractuales; **un motor determinista ejecuta las restricciones** y usa evidencia y políticas versionadas. Baja certeza => escalar, nunca autorizar por adivinanza.
- Aprobación humana es un evento **simulado** bajo un solo acceso evaluador P0. Antes de autorizar se vuelven a evaluar: reglas, contrato, cuenta, tasa de referencia y ambos presupuestos. `RECHAZADA` y `BLOQUEADA` no reservan presupuesto.
- La versión de factura y contrato, selección contractual, tasas FX y snapshots de políticas se ligan a la evaluación histórica inmutable.

### D-07 — Política editable y versiones

- Niveles: empresa, categoría, contrato, proveedor. Todas las reglas aplicables son acumulativas y la más restrictiva prevalece. La modificación de políticas genera una **versión nueva** auditada para evaluaciones futuras; resultados históricos quedan vinculados al snapshot exacto.
- Cada empresa puede definir topes por factura (automático/absoluto), global/categoría mensual, cuentas/proveedores permitidos y bloqueados, aprobaciones humanas y categorías. Los valores numéricos concretos son **datos de demo editables**, no reglas de producto.

## 4. Alcance de demostración P0 y límites

| P0, demostrable de extremo a extremo | Fuera de P0 / P1-P2 |
|---|---|
| Una empresa ficticia, usuarios mediante un acceso autenticado para evaluadores, configuración de políticas y presupuestos | Registro público y roles complejos, RBAC o separación real de responsabilidades |
| Proveedores, varias cuentas por proveedor y acuerdos en cuatro plantillas | Beneficiarios terceros, conciliación bancaria, facturación electrónica fiscal completa |
| Ingreso PDF, JPG/PNG y texto pegado representando email/chat | Lectura de buzones reales, pagos bancarios, integración Blinka no documentada |
| Extracción IA con evidencia/procedencia, revisión humana de condiciones contractuales y motor determinista | RAG avanzado, motor de contratos a medida, orquestación de pagos reales |
| Vista de decisión con aprobar/rechazar/corregir, re-evaluación y 6 estados visibles | Retirada de solicitudes, anulación de autorizaciones completadas, devoluciones, créditos, pagos parciales |
| Presupuesto dual mensual en moneda base de cada empresa (demo USD), conversión FX simulada y reservas atómicas | FX bancario real, múltiples monedas presupuestarias por categoría, gestión tesorera |
| Historial versionado, datos de entrada, razones, evidencia, costos/tokens por IA, escenarios adversarios | Event Sourcing completo, observabilidad empresarial extensa |
| Demo pública **con login**, datos simulados, claves solo servidor, API protegida | Acceso sin autenticación, proveedores o empresas reales |

**P1 recomendado:** segunda empresa aislada por `company_id` para demostrar personalización multiempresa; panel de costos/ROI y unidad económica; avisos; anulaciones y liberación compensatoria. **P2:** adaptadores de Blinka y otras integraciones reales solo con API/autorización confirmadas.

## 5. Contrato mínimo del motor de evaluación

**Entrada:** `company_id`, `invoice_id`, `invoice_version_id`, `context_version(s)` y artefactos/documentos con proveniencia; contexto de contrato, proveedor, cuenta, límites, presupuestos y FX.

**Salida estructurada por evaluación:**

```json
{
  "evaluation_id": "EV-0002",
  "invoice_id": "FAC-00042",
  "invoice_version": 2,
  "decision": "AUTHORIZE|BLOCK|ESCALATE",
  "invoice_status": "AUTORIZADA|BLOQUEADA|RECHAZADA|EN_APROBACION|EN_CORRECCION|ERROR",
  "primary_reason_code": "...",
  "checks": [{"code": "...", "result": "PASS|FAIL|UNKNOWN", "evidence_refs": ["..."]}],
  "policy_snapshot_id": "...",
  "contract_match_evidence_refs": ["..."],
  "human_resolution": "APPROVED|REJECTED|null",
  "contract_snapshot_id": "...",
  "fx_snapshot_id": "...",
  "requires_human_action": false,
  "budget_reservation_id": "...|null",
  "simulated": true
}
```

**Nota:** `ERROR` procede de fallo técnico y puede no tener `decision` financiera; no inventar un resultado de política en ese caso. El JSON anterior es una **guía de estructura**, no el esquema de validación final.

## 6. Modelo conceptual mínimo para empezar diagrama ER

`companies`, `company_categories`, `vendors`, `vendor_bank_accounts`, `contracts`, `contract_versions`, `company_policies`, `policy_versions`, `monthly_budgets`, `invoices`, `invoice_versions`, `evaluation_flows`, `evaluations`, `evaluation_checks`, `contract_match_candidates`, `approval_requests`, `budget_reservations`, `audit_events`, `fx_rates`, `uploaded_documents`.

**Invariantes:** aislamiento por `company_id`; sin autorización doble por obligación; rechazo humano separado del bloqueo automático; autorización y reserva en transacción; conservación de snapshots; corrección -> nueva versión; cambio externo -> nueva evaluación; no actualizar ni eliminar evaluaciones históricas.

## 7. Diseño que puede empezar inmediatamente

1. **Flujos UX:** alta ficticia de proveedor/contrato, configuración de límites, ingreso de factura, asociación contractual verificada, análisis, estado/acción humana, corrección, nueva evaluación, auditoría y dashboard.
2. **Arquitectura:** API y base transaccional, almacenamiento privado de evidencias, servicio de extracción IA y motor de política determinista, cola controlada de análisis, autenticación/rate limiting, logging de tokens/costos.
3. **Modelo de datos y contratos API:** ERD, estados y transiciones, endpoints, idempotencia y atomicidad, metadatos de moneda/versiones.
4. **Demo/QA:** facturas y contratos falsos con resultados esperados: autoautorización, aprobación humana, corrección, duplicado, saldo insuficiente, cuenta bloqueada, falta de moneda, FX ausente, carreras por saldo e historial tras cambio de políticas.

**Decisiones que NO bloquean diseño:** framework frontend exacto, proveedor/modelo LLM, proveedor de hosting y tamaño máximo de archivo. Son decisiones de implementación que deberán fijarse antes de desarrollar cada componente, con controles de seguridad proporcionados. No se impone cuota global artificial de llamadas LLM ni límites comerciales de tokens; sí se registra el uso y costo estimado por evaluación.

## 8. Reglas de aceptación imprescindibles

- Ninguna factura con restricción dura verificada es autorizada, incluso tras intervención humana.
- Nunca se autoriza una factura sin moneda identificada y tipo de cambio disponible cuando hace falta convertir. Cada empresa tiene su moneda base; FX simulado versionado no lo inventa el LLM.
- Nunca se autoriza por una asociación de contrato elegida incorrectamente, sea manual o sugerida por IA. Coincidencia ausente/ambigua -> corrección/evidencia.
- `RECHAZADA` es decisión humana y distinta de `BLOQUEADA`; ninguna genera reserva.
- Toda autorización reserva ambos presupuestos de forma indivisible e idempotente; no hay doble consumo ni sobreasignación.
- El documento original, las versiones corregidas, el resultado anterior y la evidencia exacta utilizada permanecen consultables.
- Dos empresas no pueden ver ni operar sobre datos de otra.
- Todo pago, autorización de pagos y actor aprobador mostrado en demo se identifica inequívocamente como **simulado**.
- Un fallo de IA, extracción incompleta o datos dudosos no se transforma en una autorización silenciosa.

---

**Estado:** baseline revisado listo para diseño P0. Las secciones de «DEFAULT DE DISEÑO» son decisiones propuestas y no deben citarse como acuerdos explícitos previos del usuario.


## 9. Cambios de la versión 1.1 y condición de ratificación

- **Confirmaciones del usuario:** separar bloqueo y rechazo; no implementar anulaciones; mantener presupuesto mensual global y categoría, sin reabrirlos; factura con ID estable y versiones.
- **Aclaración sin acuerdo todavía:** retirada de solicitud pendiente (detener voluntariamente el trámite) se recomienda **fuera de P0**.
- **Propuestas recomendadas pendientes de aceptación explícita:** moneda base elegida **por empresa**, demo USD y conversión de facturas extranjeras mediante FX simulado y auditado; emparejamiento **híbrido automático-asistido** de factura con contratos del proveedor y validación estricta incluso cuando el usuario señala un contrato. Estas propuestas habilitan diseño y se pueden ajustar sin rehacer la base del producto.

> **No confundir la asociación entre factura/contrato con una autorización:** un contrato seleccionado o sugerido siempre debe superar controles de vigencia, moneda, concepto, precios y evidencia.
