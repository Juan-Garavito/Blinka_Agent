# P1 — Dashboard de negocio, coste de IA y ROI

Fecha: 18-10-2026. Estado: **DONE (local)**. Cubre los requisitos P1 de la especificación fase 0:

| Requisito | Texto de la especificación | Estado |
|---|---|---|
| **RF-23** (P1) | Dashboard de negocio: volumen autorizado simulado, tiempo potencial ahorrado, pendientes y presupuesto. *Cada indicador tiene definición, denominador y fuente.* | **DONE** |
| **RF-30** (P1) | Costo/consumo de IA y estimación unitaria en panel de negocio. *Separar costo IA de otros costos y de ahorro económico hipotético.* | **DONE** |
| RNF-13 / métricas §6 | Consumo IA por modelo/etapa con tokens, reintentos, precio de referencia y costo estimado; costo medio de IA por factura y por etapa | **DONE** |
| Base de diseño P1 | Panel de costos/ROI y unidad económica | **DONE** (ROI de la IA con supuestos explícitos) |

Fuera de este paquete (siguen pendientes de P1): RF-20 segunda empresa en la demo (el backend ya es multiempresa), RF-22 notificaciones simuladas, RF-24 recepción por correo/chat, anulaciones con liberación de reserva.

## Qué se implementó

### Backend

- **`GET /api/business-metrics?period=YYYY-MM&reviewMinutes=15&analystHourlyUsd=12.00`** (`modules/insights/business.routes.ts`). Período = mes en la zona horaria de la empresa. Cada métrica devuelve `label`, `value`, `unit`, `definition`, `denominator` (si aplica), `source` y `hypothetical`.
- **`GET /api/ai-usage/summary?from&to&top`** (`modules/audit/audit.routes.ts`): totales real/simulado (llamadas, análisis, tokens, coste, medio por análisis), por modelo y estado, **por etapa del agente** (con reintentos), por día y facturas con mayor coste; incluye el **precio de referencia** vigente.
- `npm run ai:cost[:supabase]` — el mismo totalizado por terminal (solo lectura).
- Aritmética decimal en PostgreSQL (`numeric`) y `decimal.js`; ningún cálculo monetario con coma flotante. Todo aislado por empresa. Documentado en OpenAPI (49 rutas).

### Métricas y cómo se calculan

| Grupo | Métrica | Definición | Fuente |
|---|---|---|---|
| Hechos medidos | Facturas recibidas | Registradas en el período | `invoices.created_at` |
| | Facturas con decisión | Decisión vigente emitida en el período | última corrida completada por factura |
| | Resueltas sin intervención humana | (Autorizadas por el motor sin aprobación + bloqueadas) ÷ facturas con decisión | corridas + `trigger_type` del trámite |
| | Volumen autorizado (simulado) | Suma de reservas presupuestarias del período | `budget_reservations` |
| | Importe frenado | Importe base de las facturas bloqueadas por política | corridas |
| | Pendientes de una persona | Aprobaciones pendientes + facturas en corrección | `approval_requests` + corridas |
| Coste de IA (estimado) | Coste de IA | Suma del coste de lista de las llamadas reales (incluye pensamiento) | `ai_usage_logs.estimated_cost_usd` |
| | Coste por análisis | Coste ÷ corridas con IA real | `ai_usage_logs` |
| Ahorro y ROI (**hipotético**) | Coste manual por factura | minutos de revisión × coste/hora (supuestos) | supuestos del usuario |
| | Tiempo potencial ahorrado | facturas resueltas sin intervención × minutos de revisión (las escaladas no cuentan: criterio conservador) | supuesto × medido |
| | Coste manual evitado | tiempo ahorrado × coste/hora | supuesto × medido |
| | Ahorro neto | coste manual evitado − coste de IA (sin infraestructura) | cálculo |
| | ROI de la IA | ahorro neto ÷ coste de IA (no se calcula si el coste es 0) | cálculo |

Los supuestos (15 min y 12 USD/h por defecto) son **visibles y editables** en la interfaz y viajan en la URL; nunca se presentan como datos medidos.

### Frontend

- Vista nueva **Operaciones → Negocio y ROI** (`/business`): período y supuestos editables, tres bloques separados (hechos medidos, coste de IA, ahorro/ROI hipotético con borde discontinuo y etiqueta «hipotético»), cada tarjeta con **«Cómo se calcula»** (definición, denominador, fuente) y distribución de resultados. Acceso también desde el Dashboard.
- **Auditoría → Uso de IA**: panel «Coste de IA» con filtro de fechas, indicadores y tablas por etapa, modelo, día y factura (enlazadas al expediente), sobre el detalle por llamada.
- **Dashboard**: coste estimado de IA real en el panel «Uso de IA».

## Verificación

| Prueba | Resultado |
|---|---|
| Integración `business-metrics` | Valores calculados a mano: 10 min × 30 USD/h → 5 USD/factura; 2 resueltas → 0,33 h, 10 USD evitados; IA 0,03000001 USD → ahorro neto 9,970000, ROI 332,33×; aislamiento entre empresas; validación de período y supuestos |
| Integración `ai-usage/summary` | Suma exacta 0,01 + 0,02000001 = 0,03000001; por factura, etapa, día y modelo; aislamiento; filtro de fecha |
| Componente `Business` | Formato es-CO, separación de grupos, etiqueta hipotético y «Cómo se calcula» |
| Revisión visual (API temporal local con datos reales de los smokes) | `/business` y `/audit/ai-usage` sin errores de consola; coste 0,200811 USD coherente con `ai:cost` |

Regresión: lint, typecheck y build OK; backend y frontend en verde (cifras en STATUS).

## Limitaciones honestas

- El coste de IA es **estimado** con el precio de lista configurado al registrar cada llamada; la API de Gemini no expone la factura real.
- El ahorro y el ROI son **hipotéticos**: dependen de los supuestos y no incluyen infraestructura, almacenamiento ni el tiempo humano de los casos escalados.
- Las llamadas fallidas sin uso informado por el proveedor cuentan 0 (coste desconocido, documentado).
