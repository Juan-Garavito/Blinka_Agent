# Blinka PayGuard AI — Prompt maestro frontend P0 (FE0–FE5)

**Destino:** Claude, en el mismo repositorio existente de Blinka PayGuard AI.  
**Fecha:** 18 de octubre de 2026.  
**Objetivo:** implementar el frontend del MVP P0 conectado al backend local, utilizando React + Vite + JavaScript, sin esperar las integraciones externas Gemini, Supabase y Railway.

## 0. Situación del proyecto y normas de ejecución

El monorepo ya existe con `apps/backend` (Express + TypeScript, Drizzle, Graphile Worker, LangGraph y motor financiero) y `apps/web` reservado para React + Vite. Se ha reportado que el backend P0 y P0-HARDENING están terminados localmente, con **234/234 pruebas offline**, **3/3 verificaciones externas de Frankfurter v2** y **15 escenarios de demo en Docker Compose**. **Estos son resultados reportados; antes de implementar, comprueba el estado real del repositorio.** La IA local puede estar configurada como `FAKE (MOCK)` y el FX de la demo como `FIXTURE`; no deben presentarse como servicios reales.

Lee primero y utiliza como fuentes de verdad, cuando estén disponibles en `docs/` o adjuntos:

1. `Blinka_PayGuard_AI_Modelo_ER_v1_2.md`.
2. `Blinka_PayGuard_AI_Arquitectura_Logica_v1_1.md`.
3. `Blinka_PayGuard_AI_Reglas_Diseno_v2_1.md`.
4. `Blinka_PayGuard_AI_Especificacion_UX_UI_Navegacion_Movimiento_para_Claude_v1_0.md`.
5. OpenAPI **real** exportado del backend y el código de rutas/controladores/autenticación, especialmente cuando OpenAPI sea impreciso.
6. `docs/implementation/REPORTE_P0_HARDENING.md` y, cuando sea útil, evidencias y RUNBOOK.

**No reinicies B0–B6 ni reescribas el backend para acomodarlo a pantallas inventadas.** Confirma qué endpoints existen realmente, sus payloads, status HTTP, cookies y CSRF. Construye un mapa `vista → endpoints/acciones` antes de desarrollar. Si un endpoint está ausente, registra el bloqueo y propone un contrato mínimo; no inventes respuestas como si fueran datos reales. Se permiten datos ficticios solamente en modo demostración explícitamente identificado.

Se autoriza avanzar de FE0 a FE5, ejecutando pruebas y corrigiendo errores sin solicitar revisión entre paquetes. Registra un cierre verificable al terminar cada paquete. **No realices commits, push ni despliegues, ni modifiques bases remotas; no introduzcas secretos reales.** Si encuentras cambios locales anteriores, protégelos. No ejecutes comandos destructivos.

## 1. Reglas visuales NO negociables

- Producto empresarial B2B, **no landing page** ni dashboard genérico saturado de tarjetas.
- Dirección: **Blinka Precision Interface / Corporate Tech Premium**; composición editorial, información útil y precisa, espacios en blanco, líneas divisorias finas de 1 px, jerarquía de contenido y tipografía cuidada.
- Principal `#153454` (azul marino); profundo `#0E293F`; petróleo `#0D6871`; dorado suave `#D6A357`; fondo `#F3F7FA`; líneas `#E0E7EC`; texto `#172A3C`; secundarios `#667789`. **No usar azul eléctrico `#2563EB`.** Contraste accesible en textos/estados.
- Modo claro principal. **Navegación horizontal superior mínima**, 2–3 grupos lógicos y pestañas contextuales donde correspondan. No sidebar izquierdo permanente. En móvil utilizar menú compacto accesible.
- El Dashboard es una **vista operativa** con resumen, pendientes, actividad y enlace **Nueva factura**; **NO debe contener un formulario completo de carga** ni todos los módulos en la misma pantalla.
- El alta de factura tiene **vista propia** con selección explícita y obligatoria de proveedor, documento y validaciones. Puede ayudar a identificarlo, pero no debe ocultar la asociación responsable de la carga.
- Utiliza la antigua imagen de numerosos componentes únicamente como **catálogo visual de patrones**, no como disposición obligatoria de una sola pantalla. Claude tiene libertad creativa para resolver layouts finales, microcomposición y componentes de una manera cohesionada.
- Referencias: Heron AI (anotaciones/relaciones visuales de evidencia), Proofmode (documentos y metadatos), Kira Learning (tipografía y ritmo editorial). **NO implementar la animación inicial/intro de Heron, splash animado ni secuencia de bienvenida.** La interfaz debe abrir y ser utilizable de inmediato.
- Animaciones: GSAP + `@gsap/react` para transiciones realmente significativas; CSS para hover/foco comunes. Animar apariciones, cambios de etapa, evidencia conectada al documento, paneles contextuales y resultados **solo cuando ocurren eventos reales**, sin fabricar porcentajes ni procesos. Preferir 150–500 ms, con alguna confirmación de hasta 700 ms. Respetar `prefers-reduced-motion`; sin parpadeos, loops decorativos permanentes, scroll-jacking ni animaciones que bloqueen acciones.

## 2. Stack y límites técnicos

- **React + Vite + JavaScript** en `apps/web` como workspace npm del monorepo; mantener el único `package-lock.json` raíz.
- Usa React Router o solución pequeña y estable de navegación; aplica composición de componentes y hooks reutilizables. Decide e informa el sistema de estilos más apropiado: se favorece CSS moderno con tokens (o una alternativa liviana bien justificada). No introduzcas una librería de componentes que imponga estética genérica sin necesidad.
- `gsap` y `@gsap/react` solamente donde aporten valor; limpiar timelines en desmontaje.
- API a través de **mismo origen `/api`**: configurar proxy de Vite hacia Express local para desarrollo y preparar estrategia same-origin para despliegue. No depender de cookies compartidas entre subdominios diferentes de Railway.
- Autenticación real **por sesiones con cookies HttpOnly/Secure/SameSite**, no almacenar JWT en `localStorage`. No tratar la UI como control de autorización; el backend sigue siendo fuente de permisos. Inspeccionar mecanismo real de CSRF y enviar lo requerido.
- `fetch`/`AbortController` o solución ligera justificada; tratar 401, 403, 404, 409, 422, 429, 5xx, timeouts y desconexiones; invalidación/recarga de datos después de mutaciones.
- No usar `float` para recomputar decisiones de dinero en frontend. Mostrar cantidades/monedas de la API preservando su precisión, formato y fuente FX; los cálculos financieros autoritativos son del backend.
- Mantener gastos, límites, reservas y simulaciones **explícitamente rotulados como simulados**. No prometer transferencias ni pagos bancarios reales.

## 3. Navegación y pantallas requeridas

Implementar, a medida que lo permita la API real, las siguientes vistas en una jerarquía simple. Las rutas son **orientativas**, ajústalas a la estrategia React Router, preservando navegación consistente, deep links, atrás/adelante del navegador y estados de formulario:

| Área | Vista | Propósito y contenido esencial | Acciones y conexiones |
|---|---|---|---|
| Acceso | `/login` | Acceso correo/contraseña, feedback seguro de error, sesión | Ingresar → Dashboard; logout desde menú de usuario |
| Operaciones | `/` o `/app` | Dashboard sobrio: KPIs útiles, pendientes prioritarios, últimas facturas, presupuestos resumidos, CTA de carga | Ir a Nueva factura, detalle, aprobaciones, presupuestos |
| Facturas | `/facturas` | Lista paginada, búsqueda, filtros por estado, proveedor, fecha, divisa y orden | Nueva factura y detalle; estados explícitos |
| Facturas | `/facturas/nueva` | **Proveedor obligatorio**, documento PDF/imagen según backend, validaciones, confirmación e inicio del análisis | Adjuntar → enviar → detalle/progreso. No inventar opciones de moneda/tipo si el backend las infiere o no recibe |
| Facturas | `/facturas/:id` | Resumen con proveedor, moneda original/base, estado y decisión; pestañas: análisis, evidencia, auditoría/versiones, según datos reales | Navegar a contrato, proveedor, corregir versión, aprobación cuando aplique |
| Evaluación | contextual en detalle | Etapas técnicas de worker, duración, errores, reintentos, progreso con polling | Polling 2–5 s configurable mientras activo; detener al terminar y al desmontar; reflejar recuperación |
| Evidencia | contextual en detalle | PDF o imagen privada con acceso temporal/autorizado, campos verificados, páginas/fragmentos, diferencias y estado de corroboración humana | Ir a página/ubicación si existe; enlazar regla o cláusula; confirmar solo donde lo permite la API |
| Aprobaciones | `/aprobaciones` | Bandeja de solicitudes pendientes, motivo y contexto, acciones de simulación | Detalle → aprobar/rechazar/corrección según reglas reales; auditoría |
| Proveedores | `/proveedores`, detalle | Listado/estado, cuentas habilitadas, relaciones contractuales | Crear/editar si API lo soporta; navegar a contratos y facturas |
| Contratos | `/contratos`, detalle | Contratos, versiones, modalidad, tarifas, vigencia y referencia documental | Ver documento, reglas y facturas relacionadas |
| Control | `/politicas` | Límites y reglas de empresa/categoría/proveedor, donde el backend permita gestión | Edición con confirmaciones y advertencia de impacto |
| Control | `/presupuestos` | Presupuesto **mensual**, global y por categoría; reservado/disponible; selección de mes | Ir a facturas que consumieron presupuesto; no sumar dos veces una reserva |
| Auditoría | `/auditoria` | Historial y filtros de decisiones/acciones/tokens y origen real/MOCK cuando disponible | Navegación al recurso y evidencia relacionada |
| Configuración | `/configuracion` | Datos de empresa, moneda base, TZ, sesión; no crear administración sofisticada | Edición según endpoints existentes |

**No todas las vistas tienen que mostrar todo.** Un menú superior reducido puede agrupar `Operaciones` (dashboard, facturas, aprobaciones), `Gestión` (proveedores, contratos, políticas, presupuestos), `Auditoría` y usuario/configuración.

## 4. Estados, seguridad y reglas del producto

- Decisiones internas del motor: `AUTHORIZE`, `BLOCK`, `ESCALATE`. Nunca traducirlas en mutaciones desde el cliente.
- Seis estados finales visibles: `AUTORIZADA`, `BLOQUEADA`, `EN_APROBACION`, `EN_CORRECCION`, `RECHAZADA`, `ERROR`. Presentar nombre, icono, texto y explicación; no distinguirlos únicamente por color. `RECHAZADA` significa decisión humana simulada, distinta de bloqueo por política. `ERROR` es técnico, no rechazo.
- Distinguir estados de **etapas técnicas** (`PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED`, etc. conforme al backend) de estados de factura.
- Nueva factura o reemisión externa ≠ versión interna corregida: nunca confundir identidad original con nueva versión. Confirmaciones de PDFs escaneados deben ser auditadas y específicas de versión; no mostrar un botón «aprobar de todos modos» para discrepancias en PDFs digitales.
- No ofrecer modificación de reserva o aprobación directa desde UI cuando la política lo prohíba. Si hay proveedor nuevo/bloqueado, cuenta no aprobada o falta de contrato, mostrar el procedimiento correcto y su motivo.
- Moneda base según empresa; presupuestos imputados al mes de autorización simulada en TZ de empresa, mientras horas contractuales pueden imputarse al período de prestación.
- Si Gemini está en MOCK o FX es FIXTURE, indicar claramente «Entorno de demostración / IA simulada / tipo de cambio simulado». No representar ese análisis como ejecución en vivo de Gemini.
- No exponer credenciales de Supabase, cadena de conexión, service-role key, logs sensibles, texto integral de documentos o respuestas privadas a usuarios no autorizados.

## 5. Reglas de motion y transiciones

**Transiciones entre vistas:** navegación inmediata, sin bloqueo y sin intro; microfade/traslación corta opcional del contenido (120–250 ms), sin animar toda la pantalla en cada clic. Mantener foco y accesibilidad. Cuando se regresa a una lista, restaurar filtros y posición cuando sea razonable.

**Interacciones por flujo:**

1. **Nueva factura:** dropzone con feedback de arrastre; barra de carga solo basada en progreso real, no porcentaje inventado. Confirmación breve de registro → navegar al detalle.
2. **Análisis:** mostrar la etapa actual con un indicador sobrio, transición leve al pasar a `SUCCEEDED` y registro temporal; no usar un gráfico «Agent Operations» ornamental ni timeline que alucine las etapas. Los datos provienen de polling a la API.
3. **Evidencias:** resaltar fragmento/página real del documento y revelar panel explicativo; animación corta de línea que conecta valor y comprobación, solo si hay coordenadas/ubicación verificable. Si no, usar selección de texto/referencia sin dibujar conexiones falsas.
4. **Aprobaciones:** expandir información relevante, confirmar la acción, reflejar re-evaluación; botones con estados pending/disabled para evitar doble envío.
5. **Decisión:** comunicar autorización simulada/bloqueo/escalamiento/error con mensajes visibles, iconos y detalles; confirmación breve y no festiva para resultado financiero.
6. **Presupuestos:** animar desde el valor previamente mostrado al confirmado por backend, sin alterar los números para generar efecto; facilitar acceso al detalle.
7. **Navegación móvil:** menú desplegable con animación corta y cierre/foco correctos.
8. **Accesibilidad:** `prefers-reduced-motion`, controles de teclado, indicadores de foco, ARIA/live regions para cambios relevantes, textos alternativos donde corresponda, buen contraste y tamaños táctiles adecuados.

## 6. Paquetes de implementación (continuación autónoma)

### FE0 — Fundación

- Crear workspace de `apps/web`, scripts de raíz y Vite React JS.
- Rutas, layout público/privado, tema mediante tokens, componente de error, loader, cliente API y sesión/CSRF según backend.
- Proxy `/api`, configuración de entorno segura y README local.
- Verificar lint/build y al menos pruebas base de cliente/sesión.

### FE1 — Sistema visual + navegación + Dashboard

- Barra superior, menú contextual móvil, estilos de tablas, formularios, botones, avisos y estados.
- Dashboard **minimalista y empresarial** conectado a endpoints reales; estados de carga, vacío, error.
- CTA a Nueva factura sin incrustar el formulario.

### FE2 — Facturas, carga y polling

- Listado con filtros; formulario dedicado con selección obligatoria de proveedor y carga documental.
- Manejar subida, validaciones, error y transición a detalle.
- Polling controlado de análisis con cancelación, pausas según visibilidad, reintentos de red moderados, terminales y errores.
- Pruebas del flujo de carga y estado de progreso.

### FE3 — Detalle y trazabilidad

- Resumen, evidencias, documento autorizado, etapas, decisión, motivos, políticas/contrato, versiones y auditoría.
- Vinculaciones reales, sin evidencia inventada ni falsos pasos completados.
- Cambios visuales GSAP significativos; movimiento reducido.

### FE4 — Gestión y aprobaciones

- Aprobaciones simuladas con motivos; gestión de proveedores/contratos/políticas/presupuestos acorde con endpoints reales.
- Formularios y listas solo donde existan operaciones compatibles con API. Registrar huecos del contrato OpenAPI.
- No generar persistencia falsa para aparentar funcionalidad.

### FE5 — Calidad, integración y entrega

- Verificar responsive escritorio/tableta/móvil; estados loading/empty/error; teclado, foco, accesibilidad, animaciones.
- Pruebas unitarias/componentes (puedes incorporar Vitest/React Testing Library, justificando dependencias). Pruebas integradas con backend local y un recorrido E2E automatizado si el entorno lo permite.
- Build reproducible desde raíz, sin romper las 234 pruebas reportadas del backend; revisión de dependencias.
- Dejar despliegue Railway preparado pero **sin ejecutar**; documentar same-origin frontend/API.

## 7. Reglas de reporte, verificación y bloqueo

Al terminar cada paquete, registrar: cambios, rutas completadas, endpoints usados, pruebas **realmente ejecutadas**, problemas y deuda. Priorizar que el **flujo Dashboard → Nueva factura (proveedor) → Detalle → progreso de worker → decisión/evidencia** sea completo y demostrable contra backend local con datos ficticios.

Si falta un endpoint crítico, NO simules silenciosamente su respuesta: deja una vista honesta de capacidad no disponible, describe el endpoint y continúa con otro módulo. No conviertas el proyecto en una landing o catálogo de componentes. Si la arquitectura real difiere de esta guía, explica el motivo y el ajuste propuesto.

Entregar al final:

- `docs/implementation/REPORTE_FRONTEND_P0.md` con resumen FE0–FE5.
- Inventario de rutas y mapa ruta→endpoint.
- Evidencia de pruebas, capturas de escritorio y móvil cuando sea posible.
- Lista explícita de funcionalidades reales vs simuladas, y huecos de la API.
- Comandos para desarrollo local con API/worker y `apps/web`.
- Lista de decisiones visuales originales que tomó Claude dentro de la guía.

**Condición de éxito:** frontend profesional, usable, accesible, conectado al backend local y coherente con Blinka Precision Interface, sin introducir operaciones financieras inseguras ni afirmar integraciones externas no probadas.
