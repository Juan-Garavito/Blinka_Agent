# Blinka PayGuard AI — Especificación funcional y no funcional

**Proyecto:** Hackaton 30X · Reto Blinka  
**Fase:** 0 — Entendimiento y definición del producto  
**Versión:** 0.4 (cuestionario de cinco reglas cerrado; alcance de demo y autenticación simplificados)  
**Fecha:** 17 de octubre de 2026  
**Estado:** Reglas BR-001 a BR-005 confirmadas; Fase 0 en refinamiento, sin funcionalidades implementadas

## 1. Visión del producto

Blinka PayGuard AI (nombre provisional) es un agente de **decisión de cuentas por pagar (Accounts Payable)** para empresas con proveedores y contratistas, especialmente en operaciones internacionales. Recibe facturas, interpreta su información, comprueba su consistencia con acuerdos comerciales y aplica políticas financieras para producir **una de tres decisiones: AUTORIZAR, FRENAR o ESCALAR**. Cada decisión queda registrada con evidencia y explicaciones entendibles.

**Propuesta de valor:** automatizar las autorizaciones rutinarias sin superar los límites definidos por la empresa y trasladar a las personas únicamente las excepciones pertinentes.

**Integración potencial con Blinka:** componente de inteligencia y control *previo* a la ejecución de pagos. La demo opera con datos ficticios y adaptadores simulados. No se presupone acceso a API, back office ni arquitectura interna de Blinka.

**Objetivos priorizados:** (1) cero aprobaciones indebidas en pruebas, (2) decisiones trazables, (3) mayor autonomía segura, (4) reducción del trabajo manual.

## 2. Alcance y límites

**Incluido:** contexto de empresa, proveedores, beneficiarios y contratos/acuerdos; presupuestos y compromisos simulados; políticas y matriz simple de aprobadores ficticios; carga de facturas; extracción asistida por IA; contraste documental; evaluación determinista de reglas; decisiones; revisión humana simulada; auditoría y métricas. La demo web será accesible desde internet, pero solo usuarios evaluadores autenticados podrán utilizarla.

**Excluido:** transferencias de dinero reales, apertura de cuentas, verificación de identidad/KYC, decisiones regulatorias o antifraude, diseño interno de Blinka, gestión empresarial de usuarios/roles/SSO, y procesamiento de nómina laboral (sí se permiten cuentas de cobro de contratistas independientes). Se admiten servicios empresariales recurrentes facturados; los cargos automáticos a tarjetas corporativas quedan fuera del MVP.

**Convención de estado:** `AUTORIZAR` significa **autorización simulada para pagar**, NO transferencia ni pago ejecutado. No se enviarán mensajes afirmando que el dinero se transfirió.

## 3. Actores y responsabilidades — DEMO SIMPLIFICADA

**Autenticación real de la demo:** una cuenta de evaluador/administrador con acceso a todos los módulos, sin registro público, roles personalizables, SSO ni CRUD empresarial de usuarios. La aplicación y todos los endpoints que puedan invocar IA requieren autenticación de backend; credenciales y claves nunca se publican en el frontend ni en repositorios.

**Responsables financieros simulados:** la empresa ficticia configura en una matriz *rango o motivo de escalamiento → persona responsable ficticia*. Cuando se presenta una excepción, la interfaz muestra quién sería el aprobador y permite al evaluador **simular** su respuesta desde la misma cuenta. La operación conserva los campos `evaluator_actor` (identidad autenticada), `simulated_approver` (responsable ficticio seleccionado por la matriz), la razón, el momento y la reevaluación. El backend valida la matriz, no permite seleccionar arbitrariamente un aprobador fuera de rango y **nunca considera que una cuenta de evaluador compartida demuestre separación real de personas**. Esta distinción debe ser visible al jurado.

| Componente/actor | Responsabilidad | Alcance |
|---|---|---|
| Evaluador autenticado | Configura datos ficticios, carga facturas, observa decisiones y simula resoluciones. | Acceso completo; sesión real protegida. |
| Aprobador de negocio simulado | Identidad comercial ficticia asignada por importe/motivo. | No tiene credenciales ni identidad auténtica separada durante el MVP. |
| Agente de IA | Extrae y compara información documental; prepara explicaciones basadas en resultados verificables. | No modifica reglas, límites o identidades. |
| Motor determinista de políticas | Evalúa controles y autoriza una decisión permitida, independientemente de lo que sugiera la IA. | Siempre en backend; conserva versiones y evidencia. |

La autenticación protege **el acceso a la demo y el consumo de IA**. La matriz de autorizaciones simula un flujo B2B, no constituye control empresarial de separación de funciones en producción.

## 4. Recorrido funcional principal

1. El operador/configurador de demo registra contexto de empresa, proveedores, cuentas de destino, contratos/acuerdos, presupuestos, políticas y responsables designados.
2. Una factura llega por carga web o canal simulado.
3. La IA extrae emisor, identificador, beneficiario, conceptos, monto, moneda, fechas y referencias; reconoce campos faltantes o ambiguos.
4. El sistema identifica el acuerdo aplicable y compara cláusulas confirmadas: tarifas, cantidades, conceptos, vigencia, periodicidad, entregables o hitos.
5. El motor evalúa duplicidad, autorización de beneficiario, reglas por empresa/proveedor/contrato, límites, presupuesto y permisos de escalamiento.
6. Emite **AUTORIZAR**, **FRENAR** o **ESCALAR**, junto con las comprobaciones y evidencia utilizadas.
7. Si escala, el sistema identifica al responsable ficticio designado por rango/caso. El evaluador autenticado puede simular su resolución; la interfaz lo indica como simulación. Ninguna discrepancia contractual se autoriza sin corrección o evidencia válida y reevaluación; ninguna prohibición absoluta se omite.
8. Todo evento queda registrado; dashboard y lista de facturas muestran estados, motivos y métricas.

## 5. Requisitos funcionales

Se usan prioridades **P0** (MVP imprescindible), **P1** (diferenciación de demo) y **P2** (preparación para evolución).

| ID | Prioridad | Requisito | Resultado verificable |
|---|---|---|---|
| RF-01 | P0 | Crear/configurar una empresa ficticia, moneda base, zona horaria y datos financieros de referencia. | El contexto rige sus decisiones. |
| RF-02 | P0 | Registrar, editar y desactivar proveedores. | Solo proveedores autorizados pueden pasar validaciones de autorización. |
| RF-03 | P0 | Registrar beneficiarios y cuentas destino autorizadas por proveedor, con historial de cambios. | Una cuenta nueva sin aprobación no se utiliza para autorizar. |
| RF-04 | P0 | Registrar contratos y condiciones financieras mediante un formulario manual por usuario autorizado, con tipo, vigencia, importe, moneda y condiciones aplicables. | Es posible configurar un contrato sin utilizar IA; registra autor y versión. |
| RF-05 | P0 | Ofrecer opcionalmente un flujo asistido de carga de contrato y extracción por IA, con vista de sugerencias y confirmación humana. | Ninguna condición extraída por IA queda activa sin confirmación de usuario autorizado. |
| RF-06 | P0 | Gestionar presupuestos y compromisos simulados por período y categoría. | El disponible refleja obligaciones aprobadas/reservadas. |
| RF-07 | P0 | Configurar reglas globales, por tipo de contrato y por proveedor. | Son versionadas, comprobables y tienen precedencia definida. |
| RF-08 | P0 | Configurar límites y matriz de escalamiento (rango/caso → responsable ficticio). | El backend determina el responsable esperado y valida que toda resolución simulada corresponda a una solicitud escalada; no se afirman identidades humanas independientes. |
| RF-09 | P0 | Cargar facturas PDF e imagen y consultar documento original. | Existe registro y referencia inalterable de la versión evaluada. |
| RF-10 | P0 | Extraer campos de factura mediante IA, marcando incertidumbres. | Nunca se inventan datos críticos faltantes. |
| RF-11 | P0 | Vincular factura con proveedor/contrato y comparar condiciones aplicables. | Toda discrepancia contractual se ESCALA, explicando campo, valor pactado, valor facturado y evidencia; no se autoriza automáticamente. |
| RF-12 | P0 | Detectar duplicados confirmados y posibles duplicados. | Los confirmados se frenan; los sospechosos se escalan. |
| RF-13 | P0 | Evaluar límites, beneficiario, presupuesto, contrato y restricciones. | Ninguna regla obligatoria queda sin evaluación al autorizar. |
| RF-14 | P0 | Emitir AUTORIZAR, FRENAR o ESCALAR con códigos de motivo. | No hay autorización automática ante prohibición o incertidumbre crítica. |
| RF-15 | P0 | Gestionar bandeja y simulación de resoluciones humanas, vinculando al evaluador autenticado y al aprobador ficticio configurado. | La aprobación por importe no sustituye el alta de proveedor/cuenta ni permite ignorar bloqueos; tras resolver se reevalúa. |
| RF-16 | P0 | Revalidar reglas antes de convertir una excepción en autorización. | Cambios de presupuesto, contrato o políticas no se ignoran. |
| RF-17 | P0 | Conservar trazabilidad de extracción, reglas, documentos, versiones, actores y decisiones. | Un usuario entiende por qué se decidió sin consultar el código. |
| RF-18 | P0 | Presentar lista de facturas, detalles, línea temporal y dashboard básico de seguridad. | Se observan resultados por factura y sobre el set de pruebas. |
| RF-19 | P0 | Impedir autorizaciones duplicadas y sobreasignación por concurrencia. | Cargas repetidas y decisiones simultáneas mantienen invariantes. |
| RF-20 | P1 | Permitir una segunda empresa ficticia con datos y reglas aisladas. | Misma factura puede tener resultados distintos según contexto. |
| RF-21 | P1 | Manejar factura en divisa distinta de moneda base con tasa de referencia simulada trazable. | No se autoriza con conversión ausente o inválida. |
| RF-22 | P1 | Emitir eventos y notificaciones internas/correo simulado para solicitudes y resoluciones. | Llega al aprobador correcto sin saturarlo con autorizaciones normales. |
| RF-23 | P1 | Mostrar dashboard de negocio: volumen autorizado simulado, tiempo potencial ahorrado, pendientes y presupuesto. | Cada indicador tiene definición, denominador y fuente. |
| RF-24 | P1 | Añadir muestras de recepción desde correo/chat simulados. | Todo entra por el mismo flujo de validación. |
| RF-25 | P2 | Definir adaptadores de entrada de contexto y salida de decisiones para sistemas externos. | El núcleo no depende de una API privada de Blinka. |
| RF-26 | P2 | Incorporar nuevos canales de notificación mediante adaptadores controlados. | No se ejecuta código arbitrario de terceros. |
| RF-27 | P0 | Proteger la demo con inicio de sesión de evaluador y acceso completo a módulos. | Las rutas web y endpoints sensibles/IA exigen autenticación backend, sin altas públicas de usuarios. |
| RF-28 | P0 | Registrar uso de IA por operación y etapa: proveedor/modelo, entrada/salida, tokens, latencia, reintentos y costo estimado. | Cada invocación tiene una medición trazable con tabla de precios o supuesto explícito. |
| RF-29 | P0 | Limitar análisis simultáneos y aplicar controles contra abuso de las rutas de IA. | Solo se admiten trabajos dentro del límite de concurrencia configurado; los demás esperan o reciben respuesta controlada. |
| RF-30 | P1 | Mostrar costo/consumo de IA y estimación unitaria en panel de negocio. | Separar costo IA de otros costos y de ahorro económico hipotético. |

## 6. Reglas de negocio — versión consolidada

**Prioridad de decisiones ante múltiples incidencias:** `BLOQUEAR > ESCALAR > AUTORIZAR`. Se registran *todos* los hallazgos, no solo el que impone la decisión final. El bloqueo es un resultado sobre la versión evaluada, no una eliminación del documento; una versión corregida puede ser reevaluada con historial.

### 6.1. Cinco reglas confirmadas mediante cuestionario (cerrado)

| ID | Regla aprobada | Resultado obligatorio |
|---|---|---|
| **BR-001** | Cada empresa configura un máximo absoluto de importe por factura; superar el máximo impide autorización, incluso con consentimiento de un aprobador ordinario. | **BLOQUEAR**. |
| **BR-002** | Proveedor o cuenta bancaria **expresamente bloqueados** impiden el pago. Proveedor/cuenta **nuevos o simplemente no autorizados** son casos distintos. | Bloqueado → **BLOQUEAR**; nuevo/no autorizado → **ESCALAR** sin autorizar hasta que se valide. |
| **BR-003** | Deben cumplirse simultáneamente todas las políticas aplicables. Las políticas específicas pueden endurecer, pero no relajar las globales ni anular prohibiciones. Para límites comparables en la misma moneda, aplicar el más restrictivo. | Validar conjunto de reglas antes de la decisión. |
| **BR-004** | Si no se encuentra un contrato **o acuerdo comercial registrado** aplicable, no hay base suficiente para aprobación automática. Un acuerdo puede ser una orden de compra o condiciones confirmadas, no necesariamente un contrato formal. | **ESCALAR** explicando la falta de respaldo; prohibiciones verificadas siguen prevaleciendo. |
| **BR-005** | Toda discrepancia entre factura y acuerdo confirmado requiere explicar los campos/valores que difieren. Solo se resuelve mediante factura corregida o evidencia verificable de un acuerdo válido incorporada/confirmada; luego se **reevalúa**. Una justificación libre no sustituye la evidencia. | **ESCALAR**; no autorizar automáticamente sin subsanación y nueva evaluación. |

### 6.2. Reglas adicionales confirmadas previamente

| ID | Regla | Resultado |
|---|---|---|
| BR-006 | Duplicado **confirmado** de obligación ya registrada/autorizada; posible duplicado aún incierto. | Confirmado → **BLOQUEAR**; sospecha → **ESCALAR**. |
| BR-007 | El presupuesto disponible del período es insuficiente para una factura, contabilizando compromisos simulados; la demo no tendrá ampliación formal de presupuesto. | **BLOQUEAR**. |
| BR-008 | El importe supera el límite de autonomía automática, pero está dentro del máximo absoluto y no incumple otro bloqueo. | **ESCALAR** a responsable ficticio definido por la matriz de aprobación. |
| BR-009 | Proveedor/cuenta no autorizados requieren regularización **separada**; aprobar el importe no los autoriza. | **ESCALAR** y reevaluar una vez regularizados. |
| BR-010 | Contratos se ingresan manualmente o se interpretan con IA. Las cláusulas propuestas por IA requieren confirmación humana antes de activarse. | Solo condiciones contractuales confirmadas participan en autorización. |
| BR-011 | Campos críticos inciertos y cualquier verificación obligatoria desconocida impiden autorización autónoma. | **ESCALAR** si no hay bloqueo confirmado. |
| BR-012 | Cambiar factura, contrato, condiciones, presupuesto o políticas exige reevaluación antes de una autorización posterior. | Nuevo resultado con registro de versiones y evidencia. |
| BR-013 | La autorización no equivale a pago ejecutado; la demo no mueve dinero real. | Mostrar `AUTORIZADA_SIMULADA`, no `PAGADA`. |
| BR-014 | Documentos de terceros no pueden dar instrucciones para cambiar reglas, límites ni decisiones; la IA no cambia políticas. | Ignorar instrucciones embebidas y aplicar motor determinista. |

### 6.3. Tipos de controles y relación entre ellos

- **Prohibición absoluta:** bloquea bajo la política vigente: máximo absoluto, duplicado confirmado, proveedor/cuenta expresamente bloqueados y presupuesto insuficiente. Una aprobación ordinaria **nunca** la revierte.
- **Requisito subsanable:** evidencia contractual faltante, discrepancia explicable, proveedor/cuenta pendientes de autorización o campos críticos inciertos. Producen **ESCALAR** sin aprobación automática, a menos que también haya una prohibición confirmada.
- **Límite de autonomía:** tope para que el agente autorice sin intervención. Superarlo escala si el importe es autorizable y no hay prohibiciones.
- **Jerarquía global-específica:** se evalúa la intersección de condiciones; la regla particular no sustituye a la global. No se implementa un motor de excepciones que permita debilitar reglas superiores.

**Nota de precisión:** una factura sin contrato *formal* puede estar respaldada por una orden de compra u otro acuerdo válido **registrado y confirmado**. BR-004 se refiere a ausencia de respaldo comercial registrado, no a ausencia de un PDF titulado «Contrato».

### 6.4. Registro y activación de condiciones contractuales

- **Manual:** evaluador/operador diligencia contrato o acuerdo y condiciones mediante formulario. Registrar quién lo hizo, fecha y versión.
- **Asistido por IA:** se carga documento; la IA propone condiciones; el evaluador las revisa y confirma explícitamente. Ninguna propuesta se activa sin validación.
- **En ambos:** para comparar una factura solo se usan condiciones activas confirmadas. Evidencias correctivas o nuevos acuerdos se adjuntan antes de revaluar y siempre conservan historial; no hay una autorización excepcional libre que permita ignorar diferencias contractuales.

## 7. Ciclo de vida: separar decisiones de estados

**Decisión evaluada:** `AUTORIZAR` / `ESCALAR` / `BLOQUEAR` (el término FRENAR del reto es equivalente a BLOQUEAR en la interfaz; siempre con código de razón).

**Estado administrativo sugerido (pendiente de formalizar en modelo de estados):** `RECIBIDA` → `EXTRAYENDO` → `EN_VALIDACION` → uno de: `AUTORIZADA_SIMULADA`, `PENDIENTE_APROBACION`, `BLOQUEADA`; una factura escalada puede pasar a `PENDIENTE_CORRECCION`, `RECHAZADA_POR_HUMANO` o `EN_REEVALUACION` hasta un nuevo resultado. Las transiciones dejan eventos auditados; decisiones previas nunca se sustituyen silenciosamente.

Una autorización simulada **no equivale** a `PAGADA` ni a `TRANSFERENCIA_EJECUTADA`.

## 8. Modelo conceptual de información

- **Empresa**: identificador, datos básicos, moneda base, zona horaria.
- **Evaluador autenticado / Responsable ficticio**: única cuenta de demo real, empresas accesibles, destinatarios ficticios de la matriz por rango/motivo y registro diferenciando actor autenticado de aprobador simulado; sin modelo de roles empresariales.
- **Proveedor**: identidad comercial, estado de autorización y categoría.
- **Beneficiario/Cuenta de destino**: vinculación al proveedor, divisa, datos simulados, estado y aprobación de cambios.
- **Contrato/Acuerdo**: tipo, proveedor, vigencia, moneda, documentos y versión.
- **Condición contractual**: tarifas, plazos, frecuencia, hitos, cantidades y evidencia requerida.
- **Presupuesto / Compromiso**: empresa, categoría, período, divisa, importe, reserva o liberación.
- **Política / Versión de política**: ámbito, condición, acción, prioridad, vigencia.
- **Factura / Versión / Documento**: emisor, número, fechas, líneas, divisa, importes, archivo, huella de contenido.
- **Extracción / Evidencia**: valores inferidos, campo de origen, incertidumbres, referencias documentales.
- **Evaluación / Resultado de regla**: regla y versión, PASS/FAIL/UNKNOWN/REQUIRES_APPROVAL, valores comparados.
- **Decisión**: resultado, razones, timestamp, fuente de autoridad y vínculo a evaluación.
- **Solicitud de aprobación / Resolución**: destinatario, estado, facultad comprobada, actor y razón.
- **Evento / Notificación**: tipo, destinatario, canal, intento, estado de entrega.
- **Caso de prueba / Resultado esperado**: inputs simulados, respuesta correcta, requisitos cubiertos.

## 9. Requisitos no funcionales

| ID | Categoría | Condición de aceptación |
|---|---|---|
| RNF-01 | Seguridad de autorización | Cero aprobaciones indebidas en el set de pruebas; cualquier incertidumbre crítica detiene la autorización automática. |
| RNF-02 | Autorización mínima simulada | El backend exige evaluador autenticado, identifica la empresa y valida asignación de rango/motivo del aprobador ficticio. La cuenta compartida no prueba separación real de personas y no se presentará como tal. |
| RNF-03 | Aislamiento de empresa | No hay lectura ni modificación cruzada entre empresas; test negativo obligatorio al incorporar segunda empresa. |
| RNF-04 | Auditoría | 100% de decisiones con reglas, versiones, evidencia, motivos y actor; los eventos anteriores no se borran en el flujo ordinario. |
| RNF-05 | Idempotencia | Reenvíos de la misma solicitud no generan dos autorizaciones ni dos compromisos. |
| RNF-06 | Concurrencia | Pruebas simultáneas no exceden presupuesto ni permiten doble autorización. |
| RNF-07 | Resistencia documental | Instrucciones maliciosas en facturas/contratos no alteran políticas o permisos. |
| RNF-08 | Confiabilidad | Errores de IA, lectura documental o servicios faltantes dan resultado controlado y explicable; nunca autorización por defecto. |
| RNF-09 | Transparencia | El usuario ve resultados de reglas y evidencia; no se presenta texto generado como prueba suficiente de autorización. |
| RNF-10 | Privacidad y datos | Solo datos ficticios en hackatón; secretos y credenciales fuera de archivos públicos y registros. |
| RNF-11 | Mantenibilidad | Núcleo financiero desacoplado de IA, presentación y adaptadores externos; políticas versionadas. |
| RNF-12 | Usabilidad | Un operador puede identificar estado, motivo y siguiente acción desde el detalle de la factura. |
| RNF-13 | Observabilidad y costos | Errores, duración, decisiones y eventos consultables; consumo IA por modelo/etapa con tokens, reintentos, precio de referencia y costo estimado, sin datos sensibles. |
| RNF-14 | Desempeño | Medir latencia de extracción y decisión sobre un conjunto fijo; objetivo concreto se fija tras probar hardware/modelo de la demo. |
| RNF-15 | Evaluación reproducible | Dataset de facturas etiquetado, ejecutable repetidamente y separado de ejemplos usados para ajustar el agente. |
| RNF-16 | Acceso demo pública | Frontend público solo en login; endpoints de IA y datos requieren autenticación backend; no habilitar auto-registro; aplicar rate limiting. |
| RNF-17 | Protección operativa | Limitar la concurrencia de análisis IA; registrar errores y rechazos controlados para estabilidad y recuperación. |
| RNF-18 | Alcance de controles de costo | No se impone cuota global de peticiones ni un límite funcional configurable de tokens en la demo; medir consumo para estimar costos. Esto NO garantiza tope de gasto. |
| RNF-19 | Documentos | El límite funcional de formatos, páginas y tamaño y la elección entre extracción directa/RAG quedan pendientes de diseño técnico. Se exigirán validaciones básicas de seguridad y protección del servidor ante cargas abusivas. |

## 10. Métricas y fuentes

### Seguridad y calidad del agente

- **Aprobaciones indebidas:** número de `AUTORIZAR` cuando la etiqueta correcta era `ESCALAR` o `FRENAR`. Meta en dataset de evaluación: **0**.
- **Precisión de aprobación:** autorizaciones automáticas correctas / total de autorizaciones automáticas. Reportar numerador y denominador; si no hay autorizaciones no declarar 100%.
- **Recall de autorización elegible:** facturas aptas que el agente autorizó / total de facturas aptas.
- **Errores de clasificación FRENAR vs ESCALAR:** matriz de confusión, mostrando errores separados.
- **Trazabilidad completa:** decisiones con evidencia y reglas reconstruibles / total de decisiones. Meta: 100%.
- **Duplicados autorizados:** meta 0.
- **Violaciones de límites/presupuesto:** meta 0.
- **Exactitud de extracción de campos críticos:** medir contra valores correctos etiquetados.
- **Seguridad de políticas compuestas:** casos que disparan simultáneamente bloqueos y escalaciones, prevalece BLOQUEAR y se conservan todos los motivos.

### Producto y negocio

- Facturas evaluadas, autorizadas simuladamente, bloqueadas y pendientes.
- Porcentaje de casos elegibles automatizados; tasa de escalamiento innecesario.
- Tiempo promedio/percentil desde carga hasta decisión.
- Tiempo potencial ahorrado **estimado** con base manual declarada (no presentar como ahorro observado en clientes reales).
- Volumen monetario **autorizado simuladamente** por divisa y moneda base con tasa registrada.
- Presupuesto disponible, comprometido, excepciones pendientes y tiempo de resolución.
- **Costo de IA por factura:** suma de llamadas de extracción, análisis, reintentos y explicación (si aplica); registrar tokens de entrada/salida/cache, modelo, precio de referencia y costo calculado. Distinguir costo de interpretación única de contrato del costo recurrente de evaluación de facturas.
- **Economía unitaria para Blinka:** costo medio de IA por factura y por etapa, costo de intervención humana *estimado* cuando se cuente con supuestos explícitos. No presentar el costo de IA por sí solo como el costo total de operar el producto ni como ahorro medido de clientes reales.

Los dashboards mostrarán la fuente de cada métrica: **dataset de pruebas** para seguridad y **operaciones ficticias** para métricas operativas. Nunca convertir el total bloqueado automáticamente en «dinero ahorrado».

## 11. Escenarios mínimos para validación

| Caso | Respuesta esperada inicial |
|---|---|
| Factura válida, contrato consistente, beneficiario autorizado, presupuesto suficiente | AUTORIZAR |
| Tarifa distinta de contrato, sin adenda confirmada | ESCALAR con tarifa pactada vs. facturada y diferencia exacta |
| Entregable obligatorio sin evidencia | ESCALAR |
| Número de factura ya autorizado, coincidencia confirmada | BLOQUEAR |
| Posible duplicado por similitud no concluyente | ESCALAR |
| Proveedor nuevo o cuenta destino modificada sin validar | ESCALAR para autorizar proveedor o cuenta; aprobar importe no sustituye este paso |
| Excede límite automático, pero cabe en matriz humana | ESCALAR |
| Supera límite absoluto configurable por empresa | BLOQUEAR |
| Excede presupuesto disponible | BLOQUEAR; no existe ampliación presupuestaria en la demo |
| Monto/moneda ambiguos | ESCALAR |
| Factura con instrucciones para manipular IA | Ignorar instrucciones; decidir solo por datos y reglas |
| Dos facturas simultáneas agotan mismo presupuesto | Nunca autorizar ambas si exceden disponible |
| Política o factura modificada antes de aprobación humana | Revalidar antes de autorizar |
| Factura en COP/MXN y políticas en USD sin tasa válida | ESCALAR |
| Intento de acceder a facturas de otra empresa | Acceso denegado |
| Proveedor expresamente bloqueado | BLOQUEAR |
| Cuenta bancaria expresamente bloqueada | BLOQUEAR |
| Proveedor nuevo/cuenta nueva todavía sin autorizar | ESCALAR |
| Sin contrato o acuerdo comercial registrado aplicable | ESCALAR y explicitar ausencia de respaldo |
| Factura corregida / evidencia nueva validada | Crear nueva evaluación, conservar decisión anterior |
| Discrepancia contractual + presupuesto insuficiente | BLOQUEAR y registrar ambos hallazgos |
| Regla específica más restrictiva que global | Aplicar la restricción específica sin desactivar la global |

Crear al menos 30–50 ejemplos diversos, etiquetados **antes** de ejecutar la evaluación final, con un subconjunto no usado para ajustar prompts/reglas.

## 12. Desglose por fases

| Fase | Objetivo | Entregable medible |
|---|---|---|
| F0 | Acordar dominio, reglas, requisitos y estructura de pruebas | Esta especificación aprobada, backlog, riesgos y arquitectura de alto nivel |
| P0 | Flujo vertical seguro de extremo a extremo | Login demo → factura → extracción → contraste → reglas → decisión → auditoría → aprobación humana simulada; dataset básico pasando; medición de costo IA y límite de concurrencia |
| P1 | Demo B2B diferenciadora | Segunda empresa aislada, multimoneda, notificaciones simuladas, dashboard de negocio/costo IA y escenarios avanzados |
| P2 | Preparar evolución de producto | Contratos de integración y adaptadores extensibles; sin acceso a APIs reales |

## 13. Estado del análisis: cerrado vs. pendiente

### 13.1. Decisiones CERRADAS del cuestionario y refinamientos anteriores

- BR-001 a BR-005 confirmadas en la sección 6.1; no volver a abrir el cuestionario salvo que exista una contradicción real.
- Duplicados confirmados → BLOQUEAR; presupuesto insuficiente → BLOQUEAR sin ampliaciones en demo; fuera del umbral automático dentro de máximo absoluto → ESCALAR.
- Contratos manuales **y** asistidos por IA, con confirmación antes de usar extracciones IA en decisiones.
- Un usuario autenticado con acceso completo a la demo; no implementar RBAC empresarial. La aprobación humana por personas distintas solo se **simula**, sin afirmar segregación de funciones real.
- Demo pública protegida contra acceso no autorizado a endpoints de IA; rate limiting y concurrencia limitada; registrar consumo y costos. Sin cuota global de análisis ni límite funcional de tokens para la demo.
- Nada de nómina tradicional ni cargos automáticos a tarjetas; sí cuentas por pagar de proveedores/contratistas y servicios empresariales facturados.

### 13.2. Pendientes REALES para completar la Fase 0

| ID | Entregable/decisión pendiente | Por qué importa | Prioridad de definición |
|---|---|---|---|
| F0-01 | **Modelo de dominio detallado:** relaciones Empresa–Proveedor–Cuenta–Acuerdo–Factura–Presupuesto–Evaluación–Decisión, claves, versiones y pertenencia a empresa. | Evita incoherencias al implementar. | Alta |
| F0-02 | **Datos mínimos por documento y tipo de acuerdo:** qué campos son obligatorios para recurrente, por horas/hitos y orden de compra; evidencias alternativas aceptables. | Define qué puede comparar el agente. | Alta |
| F0-03 | **Flujos completos de escalamiento y reevaluación:** quién atiende un caso en la simulación, qué operación puede realizar, cuándo queda `PENDIENTE_CORRECCION`, cómo se cierra la falta de acuerdo y qué eventos se auditan. | BR-004 y BR-005 requieren una resolución concreta, no solo ESCALAR. | Alta |
| F0-04 | **Modelo de presupuesto:** período, categoría, moneda, qué se reserva al autorizar, cuándo se libera una reserva al rechazar/corregir y cómo evitar doble conteo. | Asegura que la regla de insuficiencia sea consistente. | Alta |
| F0-05 | **Matriz de autorización simple:** rangos exactos de ejemplo, máximo absoluto, asignación por tipo de excepción y qué opciones aparecen al evaluador. | Demuestra autorización humana sin RBAC. | Alta |
| F0-06 | **Mapa UX básico:** configuración → contratos → facturas → explicación → simulación de aprobación → auditoría → dashboards. | Evita pantallas inconexas. | Media |
| F0-07 | **Métricas con fórmulas y fuentes; dataset de referencia:** etiquetar 30–50 facturas y casos combinados, separar test/ajuste, fijar criterios de P0. | Permite demostrar seguridad de forma reproducible. | Alta |
| F0-08 | **Arquitectura de alto nivel e interfaces:** fronteras entre IA, reglas deterministas, almacenamiento documental, métricas y adaptadores. Evaluar extracción directa vs RAG según volumen. | Habilita integración futura sin inventar API de Blinka. | Media |
| F0-09 | **Backlog:** épicas e historias P0/P1/P2 con criterios de aceptación y pruebas negativas. | Permite planificar implementación incremental. | Media |

### 13.3. Decisiones que NO deben retrasar la Fase 0

- Framework, nube, base de datos, LLM y proveedor de correo: decisiones de arquitectura/implementación después de la especificación funcional.
- Un esquema RAG o una base vectorial: no se necesita elegir hasta conocer longitud, tipos y cantidad de documentos.
- Número/tamaño/páginas máximas de archivos: no establecer una restricción funcional de negocio de forma arbitraria en F0; sí diseñar validaciones básicas de seguridad operativa.
- Canales extra de notificación y plugins configurables: P2, no bloquear P0.
- Costos finales para Blinka: se obtienen mediante mediciones del prototipo, distinguiendo uso de IA, infraestructura y revisión humana.

## 14. Criterio de salida de Fase 0

La fase concluye cuando: (a) se ratifica esta lista priorizada de capacidades y su alcance, (b) están formalizados dominios/estados/relaciones y acuerdos mínimos, (c) funcionan en el papel las reglas BR-001 a BR-014 y su precedencia, (d) se conoce el flujo de revisión/corrección/autorización simulada, (e) se dispone de dataset etiquetado y métricas verificables, (f) está definido el mapa UX básico, (g) existe arquitectura de alto nivel y (h) se ha descompuesto P0 en historias con pruebas de aceptación. **El cuestionario BR-001 a BR-005 está CERRADO, pero la Fase 0 aún no está terminada.**

## 15. Historial de cambios

| Versión | Cambio |
|---|---|
| 0.3 | Simplificación de roles hacia matriz de aprobación; reglas iniciales pendientes de confirmar. |
| 0.4 | Confirmadas BR-001…005; ajuste a evaluador único autenticado, aprobación humana simulada, protección de costos/consumo y lista específica de pendientes F0. |

**Nota:** el documento es una especificación de producto y pruebas para la hackatón, no evidencia de implementación ni garantía de compatibilidad con APIs privadas de Blinka.
