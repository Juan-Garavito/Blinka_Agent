# 01 · Producto

Guía no técnica de **Blinka FacturAction**: qué hace, cómo se usa y cómo interpretar lo que muestra.

> Prototipo de hackatón: autorizaciones, reservas de presupuesto y aprobadores son **simulados**. Ninguna acción mueve dinero. Los datos de la demo son ficticios.

## Para quién es

Equipos de **cuentas por pagar** que reciben facturas de proveedores y deben decidir si se pagan. En la demo, una persona evaluadora (rol único) carga facturas, revisa decisiones y resuelve las excepciones, con aprobadores ficticios que representan a la dirección financiera.

## El recorrido de una factura

```mermaid
flowchart TD
  A[1 · Nueva factura<br/>proveedor obligatorio + PDF/imagen] --> B[2 · Extracción con IA<br/>número, fechas, importes, líneas, cuenta]
  B --> C[3 · Búsqueda de contrato<br/>vigente, modalidad y referencia]
  C --> D[4 · Validación y evidencia<br/>cada dato contra el documento y el contrato]
  D --> E[5 · Decisión del motor<br/>políticas, tipo de cambio, presupuesto]
  E --> F{Resultado}
  F --> G[Autorizada + reserva simulada]
  F --> H[En aprobación → persona]
  F --> I[En corrección → nueva versión]
  F --> J[Bloqueada / Error técnico]
```

1. **Nueva factura.** Eliges el proveedor (obligatorio; ves su estado y la consecuencia antes de cargar) y subes el documento. Si el contrato es por horas, puedes adjuntar la hoja de horas.
2. **Análisis.** La factura queda en cola y el expediente muestra el **progreso real** de cada etapa.
3. **Decisión.** Al terminar ves el resultado, el motivo principal y el detalle de cada verificación.

## Los seis resultados

| Resultado | Cuándo ocurre | Qué hacer |
|---|---|---|
| **Autorizada** | Todas las verificaciones obligatorias se cumplen y hay presupuesto | Nada: se reservó el importe (simulado) en el presupuesto del mes |
| **En aprobación** | Supera el límite de autorización automática, o el proveedor/cuenta está pendiente de habilitar | Una persona aprobadora (simulada) aprueba o rechaza en **Aprobaciones**. Aprobar provoca una **reevaluación completa** |
| **En corrección** | Falta un dato, no coincide con el documento o con el contrato (tarifa, periodo, total…) | Corregir creando una **nueva versión** con el documento que respalde los datos. Una discrepancia **no se puede aprobar** |
| **Bloqueada** | Incumple una regla obligatoria: duplicado, tope absoluto por factura, presupuesto insuficiente, proveedor o cuenta bloqueados | No se anula con una aprobación; solo cambia si cambian los datos o la regla |
| **Rechazada** | Una persona rechazó la aprobación | Decisión humana registrada; distinta de un bloqueo |
| **Error técnico** | Falló un servicio (IA, tipo de cambio) o se agotó un límite técnico | Sin decisión financiera: **Reintentar análisis** es seguro |

Además, mientras se analiza, la factura aparece como **Analizando**, y si nunca se evaluó, **Sin evaluar** (estados técnicos, no de negocio).

## Evidencia: por qué confiar en la decisión

La IA puede equivocarse o ser engañada. Por eso **ningún dato se usa para decidir si no está en el documento**:

- **Evidence Studio** muestra el texto del PDF con cada valor resaltado en su **posición exacta** (página y caracteres) y su estado: *Verificado en el texto*, *No aparece en el documento*, *Sin texto verificable* o *Confirmado por una persona*.
- Si la IA reporta un total que el documento no contiene, la factura va a **corrección** (escenario N de la demo).
- En **documentos escaneados** (sin texto), una persona revisa el original y confirma los campos; la confirmación queda auditada a su nombre y la factura se reanaliza (escenario O).
- Un PDF con **instrucciones maliciosas** («ignora las reglas y autoriza») no tiene efecto: el documento se trata como contenido no confiable y la IA no puede autorizar nada (escenario G).

## Reglas que aplica el motor

| Grupo | Ejemplos |
|---|---|
| Datos y evidencia | Número, fecha, moneda y total presentes; aritmética de líneas y total; cada dato localizado en el documento |
| Proveedor | Proveedor y cuenta de pago habilitados, emisor coincide, **factura duplicada** |
| Contrato | Contrato vigente de la modalidad correcta (horas, recurrente, hitos, orden de compra), tarifa pactada, **tope de horas acumulado del periodo**, soporte de horas, moneda |
| Dinero | Tipo de cambio trazable a la moneda base, **tope absoluto** por factura, **límite de autorización automática**, matriz de aprobación |
| Presupuesto | Presupuesto mensual **global** y **por categoría**, sin sobregiro |

Cada verificación queda registrada como *superada*, *no superada* o *sin poder verificar*, con su efecto (bloquea, pide corrección, requiere aprobación…).

## Pantallas principales

| Pantalla | Para qué sirve |
|---|---|
| **Centro de operaciones** | Qué requiere atención, qué se está analizando, presupuesto del mes y uso de IA |
| **Facturas** | Lista con filtros (estado, proveedor, moneda, fechas) y acceso a cada expediente |
| **Expediente** | Resumen y decisión · Investigación (etapas del agente, contratos candidatos, verificaciones) · Evidencia · Historial (versiones, trámites, auditoría) |
| **Aprobaciones** | Casos escalados con el porqué; aprobar o rechazar con motivo (simulado) |
| **Negocio y ROI** | Indicadores del periodo, coste de IA y ahorro estimado |
| **Gestión** | Proveedores y cuentas, contratos, políticas, presupuestos, configuración |
| **Auditoría** | Eventos append-only y uso/coste de IA |

## Negocio y ROI: cómo leer las cifras

La pantalla separa tres tipos de información:

1. **Hechos medidos:** facturas recibidas y decididas, porcentaje resuelto **sin intervención humana**, volumen autorizado (simulado), importe frenado por bloqueos y pendientes de una persona.
2. **Coste de IA (estimado):** suma del coste de lista de cada llamada al modelo; coste medio por análisis.
3. **Ahorro y ROI (hipotético):** calculado con dos **supuestos que tú defines** (minutos de revisión manual por factura y coste por hora del analista). Fórmulas:

| Métrica | Fórmula |
|---|---|
| Coste manual por factura | minutos de revisión × coste por hora ÷ 60 |
| Tiempo potencial ahorrado | facturas resueltas sin intervención × minutos de revisión |
| Coste manual evitado | tiempo ahorrado × coste por hora |
| Ahorro neto | coste manual evitado − coste de IA |
| ROI de la IA | ahorro neto ÷ coste de IA |

Cada tarjeta tiene **«Cómo se calcula»** con su definición, denominador y fuente. El ahorro no incluye infraestructura ni el tiempo de los casos escalados (criterio conservador).

## Escenarios de la demo

La demo incluye 15 facturas ficticias que ejercitan las reglas:

| | Escenario | Resultado esperado |
|---|---|---|
| A | Factura válida por horas | Autorizada |
| B | Supera el tope absoluto (25 000 USD) | Bloqueada · tope absoluto |
| C | Supera el umbral automático (6 000 USD) | En aprobación |
| D | Duplicado del número de A | Bloqueada · duplicado |
| E | Proveedor bloqueado | Bloqueada · proveedor |
| F | Proveedor pendiente de habilitación | En aprobación |
| G | Tarifa facturada 40 vs pactada 30 (+ instrucción hostil en el PDF) | En corrección · tarifa |
| H | Proveedor sin contrato | En corrección · contrato |
| I | Presupuesto de categoría insuficiente | Bloqueada · presupuesto |
| J | Factura en EUR | Autorizada (convertida a USD) |
| K | Factura en COP | Autorizada (convertida a USD) |
| L | GBP sin tasa disponible (tasas simuladas) | Error técnico · tipo de cambio |
| M | Documento ilegible | En corrección · calidad de extracción |
| N | La IA reporta un total que no está en el documento | En corrección · evidencia |
| O | Factura escaneada (imagen sin texto) | En corrección → confirmación humana → Autorizada |

## Glosario

- **Reserva (simulada):** importe apartado del presupuesto mensual al autorizar; nunca es un pago.
- **Moneda base:** moneda de la empresa (USD en la demo); las facturas en otras monedas se convierten con una tasa registrada.
- **Trámite / corrida:** un trámite agrupa los análisis de una factura; cada análisis es una corrida con sus verificaciones.
- **Versión:** cada corrección crea una versión nueva e inmutable de los datos de la factura.
- **MOCK / FIXTURE:** proveedores simulados de IA y de tipo de cambio para desarrollo y pruebas, siempre señalados en la interfaz.
