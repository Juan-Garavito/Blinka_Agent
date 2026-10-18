# BLINKA PAYGUARD AI
## Reglas de diseño, identidad visual e interacción — v2.1

**Proyecto:** Hackaton 30X / Blinka PayGuard AI  
**Fecha:** 18 de octubre de 2026  
**Estado:** dirección visual aprobada como base del rediseño; especificaciones de implementación propuestas para revisión en los nuevos wireframes.  
**Sustituye:** guía UX/UI v1.0 en materia de composición, navegación, componentes y tratamiento visual; mantiene las decisiones funcionales y de seguridad del producto.  
**Alcance:** aplicación B2B de cuentas por pagar, con agentes de IA y autorización de pago **simulada**, nunca transferencia real.

> **Manifiesto visual.** Blinka no debe parecer otro panel de administración con métricas dentro de tarjetas. Debe sentirse como un **instrumento inteligente de inspección financiera**: editorial, preciso, luminoso y confiable. La información, los documentos y las evidencias son protagonistas; las animaciones explican el trabajo real del sistema.

## 1. Referencias y traducción al producto

| Referencia | Inspiración a adoptar | Evitar copiar |
|---|---|---|
| [Proofmode — Godly](https://godly.design/website/proofmode/) | Documento/imagen protagonista; metadatos y pruebas integrados al contenido; capas de información legibles. | Ornamentación que tape facturas o evidencia. |
| [Kira Learning — Godly](https://godly.design/website/kira-learning/) | Ritmo editorial, titulares expresivos, cambios de escala y composición, espacios en blanco. | Tipografía decorativa que dificulte leer cifras o tablas. |

Estas son **referencias de lenguaje visual**, no templates ni especificaciones del producto. No copiar identidad, marcas, ilustraciones ni animaciones originales. Las líneas técnicas, anotaciones y relaciones entre evidencias se mantienen como recursos funcionales propios de Blinka, **sin tomar la animación de entrada de Heron AI** como referencia.

**Cambio v2.1 — apertura inmediata:** no implementar splash screen, intro animada, secuencia cinematográfica, bloqueo inicial, animación de marca obligatoria ni espera artificial. Tras autenticar, mostrar de inmediato la interfaz útil; las animaciones ocurren al interactuar o cuando cambian datos reales.

## 2. Principios no negociables

1. **Menos contenedores, más estructura:** priorizar separación mediante líneas de 1 px, retícula, blancos y alineaciones en lugar de encerrar todo en cards.
2. **La evidencia primero:** documento, dato extraído, cláusula contractual, regla y resultado deben poder seguirse visualmente.
3. **Una escena principal por pantalla:** cada vista tiene una zona protagonista y elementos secundarios discretos; evitar rejillas repetitivas de cuatro KPI.
4. **Movimiento con significado:** GSAP solo enfatiza un hecho confirmado o revela una relación verificable; jamás fabrica un progreso o una decisión.
5. **Confianza y control:** los seis estados, los importes, la moneda, la fuente de FX y las razones de bloqueo son inequívocos.
6. **Navegación mínima, no escondida:** pocos destinos principales; el resto contextual, accesible y descubrible.
7. **Rendimiento y accesibilidad:** interacción inmediata, contraste suficiente, teclado, lectores de pantalla y movimiento reducido.
8. **Sin intro de presentación:** ninguna animación de bienvenida al entrar o recargar; contenidos operativos disponibles inmediatamente.

## 3. Identidad y tokens de color

### 3.1. Paleta de marca

| Token CSS | Color | Uso autorizado |
|---|---|---|
| `--brand-navy` | `#153454` | **Principal definitivo:** marca, titulares, navegación, botones primarios y superficies de alto contraste. |
| `--brand-navy-deep` | `#0E293F` | Profundidad, hover sobre azul, pequeños módulos de análisis. |
| `--brand-petrol` | `#0D6871` | Actividad y herramientas del agente, indicadores, enlaces y líneas de conexión. |
| `--brand-petrol-dark` | `#09545C` | Hover, foco reforzado y texto sobre fondos claros. |
| `--brand-gold` | `#D6A357` | Puntos de atención, nodos seleccionados, acento premium **solo con moderación**. |
| `--brand-petrol-soft` | `#D9EEEA` | Resaltados de evidencia y áreas de actividad IA. |
| `--canvas` | `#F7F9FB` | Fondo general predominantemente claro. |
| `--paper` | `#FFFFFF` | Superficie de documentos, contenido y formularios. |
| `--ink` | `#172A3C` | Texto principal. |
| `--muted` | `#667789` | Texto secundario. |
| `--line` | `#DFE7EC` | Divisores, retícula discreta y tablas. |

**Prohibición explícita:** no reintroducir el azul eléctrico `#2563EB` como color de acción. No generar gradientes neón, fondos oscuros completos ni decoraciones doradas constantes. Usar el azul marino como identidad, no para saturar cada sección.

### 3.2. Colores semánticos, independientes de marca

| Estado de negocio | Color | Significado |
|---|---|---|
| `AUTORIZADA` | `#146C43` verde | Autorización **simulada** y reserva confirmada. |
| `EN_APROBACION` | `#A15C07` ámbar | Pendiente de intervención humana simulada. |
| `EN_CORRECCION` | `#B54708` naranja | Faltan o discrepan datos/evidencias corregibles. |
| `BLOQUEADA` | `#B42318` rojo | Incumplimiento obligatorio, no anulable mediante aprobación simple. |
| `RECHAZADA` | `#881337` granate | Rechazo humano simulado; nunca confundir con bloqueo automático. |
| `ERROR` | `#6D28D9` violeta | Falla técnica; nunca implica decisión financiera favorable. |

Cada estado debe incluir **texto + icono + explicación**; no depender exclusivamente del color. El progreso técnico del worker es distinto de estos seis estados.

## 4. Tipografía y jerarquía editorial

- **Títulos y expresiones editoriales:** `Manrope` (propuesta), con `system-ui` como respaldo; pesos 500–700. Permitir titulares grandes, respiración y saltos de línea intencionales.
- **Interfaz, tablas y datos:** `Inter` (propuesta), fallback `system-ui, sans-serif`; números con `font-variant-numeric: tabular-nums`.
- **Metadatos técnicos:** Inter mono/monoespaciada opcional *solo* en IDs, versiones, códigos y timestamps; evitar monoespaciada en texto narrativo.
- **Escala desktop orientativa:** H1 editorial 40–56 px; título de pantalla 28–36 px; H2 22–28 px; cuerpo 14–16 px; etiquetas 12–13 px; detalle técnico nunca inferior a 12 px si es necesario para entender una decisión.
- **Disciplina:** máximo dos familias tipográficas; 3–4 pesos por familia; números financieros alineados; titular expresivo sin perjudicar escaneabilidad.

## 5. Composición, retícula y superficies

**Patrón principal: lienzo editorial de precisión.** Diseñar primero la jerarquía del contenido; después la delimitación visual.

- Fondo claro (`--canvas`) con secciones en blanco; retícula técnica muy tenue solo donde aporta contexto, nunca cubriendo todos los módulos.
- Desktop: contenedor flexible hasta aprox. 1440–1600 px, márgenes 32–56 px; disposición asimétrica 60/40 o 65/35 cuando haya panel principal + contexto.
- Separadores finos de **1 px** y alineaciones precisas; no usar marcos gruesos o sombras elevadas como lenguaje predeterminado.
- Espaciado base de 8 px; escala 8 / 12 / 16 / 24 / 32 / 48 / 64 px según jerarquía.
- Esquinas discretas (0–8 px) para módulos editoriales; 8–12 px para inputs/acciones; no repetir tarjetas de 16 px con sombras en toda la aplicación.
- Un panel marino protagonista por vista como máximo, cuando aporte foco. No construir la página entera en modo oscuro.
- Tablas tipo *ledger*: filas separadas por líneas, encabezados sobrios, importes a la derecha, moneda explícita, columnas priorizadas y acciones contextuales.
- Números y métricas integrados en franjas, tipografía o listas, en vez de cuatro tarjetas idénticas.

### 5.1. Recursos distintivos permitidos

**Anotaciones de evidencia:** marcadores discretos sobre importe, proveedor, número de factura o cláusula, vinculados a un panel de explicación.

**Líneas de relación:** trazos finos entre origen documental, contrato y regla; siempre vinculados a referencias reales, con alternativa textual equivalente.

**Metadatos editoriales:** prefijos como `FACTURA / 0042`, `EVIDENCIA 03`, `VERIFICACIÓN 06/09`, fecha, fuente y versión en segundo plano visual.

**Contraste de escena:** títulos expresivos sobre lienzo claro y una zona de investigación marino/petróleo, sin efectos neón.

## 6. Navegación: mínimo necesario

**No sidebar izquierdo permanente.** Usar navegación horizontal superior, de perfil delgado y con la menor cantidad de opciones de primer nivel.

**Propuesta de primer nivel (3 grupos):** `Operaciones` · `Gestión` · `Auditoría`. La marca funciona como acceso a inicio/overview. El acceso a `Nueva factura` es una acción contextual visible en Operaciones y Facturas, no otra sección global.

- **Operaciones:** Dashboard/visión general, Facturas, Aprobaciones.
- **Gestión:** Proveedores, Contratos, Políticas, Presupuestos, Configuración.
- **Auditoría:** Eventos, evaluaciones, trazas y consumo IA.
- **Dentro de una factura:** pestañas contextuales `Resumen`, `Investigación`, `Evidencias`, `Historial`.
- Indicador de sección activa fino y inequívoco; no múltiples barras de navegación anidadas con subrayados competidores.
- Menús desplegables concisos; foco, teclado, Escape y cierre por clic exterior. En móvil se colapsan grupos en un menú accesible.
- Mostrar breadcrumbs breves cuando se navegue a un detalle; conservar filtros al volver a listas.

La agrupación exacta de rutas se validará con los wireframes v2.0; este documento fija la intención de **reducir ruido de navegación**.

## 7. Escenas UX por pantalla

| Pantalla | Escena protagonista | Qué debe evitarse |
|---|---|---|
| Login | Marca, mensaje claro y formulario breve; apariencia confiable. | Fondos recargados y varios CTA. |
| Dashboard | **AI Command Center:** actividad reciente, situaciones que requieren atención y una visualización de análisis real. | Cuatro KPI iguales y gráficas decorativas. |
| Facturas | **Ledger editorial:** lista priorizada, estados, moneda, fecha, proveedor; filtros discretos. | Tarjetas por factura en desktop y tablas densas sin jerarquía. |
| Cargar factura | Zona documental protagonista, flujo guiado breve, vista previa y validación. | Formularios de varias columnas sin necesidad. |
| Detalle | **Evidence Studio:** documento + vínculo a cláusula + resultado de checks. | Relegar el PDF a un modal y separar toda evidencia en páginas inconexas. |
| Aprobaciones | Cola de decisiones contextual: motivo, evidencia, actor simulado y acción segura. | Botones de aprobar sin mostrar por qué se escaló. |
| Proveedores/Contratos | Registros tipo ledger + ficha enfocada en estado, modalidades y cuentas válidas. | Paneles excesivamente ornamentados. |
| Políticas/Presupuestos | **Risk Radar:** consumo mensual legible y reglas accesibles; gráficos solo si explican algo. | Medidores decorativos que oculten importes exactos. |
| Auditoría | Línea temporal y tablas de trazas con filtros y datos verificables. | Recrear una cadena de pensamiento interna del LLM. |
| Configuración | Formularios austeros y accesibles; datos críticos claros. | Efectos de movimiento que distraigan en edición. |

## 8. GSAP: lenguaje de movimiento

**Tecnologías:** React + Vite + JavaScript; `gsap` + `@gsap/react` para animaciones coordinadas; CSS nativo para hover, foco y transiciones simples. **GSAP se incorpora formalmente al stack visual**.

### 8.1. Momentos prioritarios

| Disparador real | Animación permitida | Duración objetivo |
|---|---|---|
| Abrir dashboard o recargar | **Sin animación de entrada; renderizar contenido inmediatamente.** | 0 ms de espera artificial |
| Factura recibida por la API | Apertura de escenario de investigación. | 300–500 ms |
| Nueva etapa confirmada por polling | Trazar segmento de línea y revelar estado/check. | 300–550 ms |
| Contrato compatible identificado | Conectar visualmente factura ↔ contrato; etiqueta de evidencia. | 350–650 ms |
| Evidencia validada | Resaltar cláusula/dato y abrir anotación contextual. | 200–450 ms |
| Bloqueo o corrección | Mostrar señal de riesgo y motivo inmediatamente; énfasis único. | 200–450 ms |
| Autorización transaccional confirmada | Revelar resultado y actualización de reserva presupuestaria. | 400–700 ms |
| Cambio de pestaña | Microtransición discreta, sin retrasar contenido. | 120–250 ms |

### 8.2. Reglas de integridad y accesibilidad del movimiento

**No permitido:** reproducir la animación introductoria de Heron AI, pantallas de bienvenida animadas, timelines automáticas de marca o secuencias decorativas previas a poder operar.

- **Nunca** inventar progreso porcentual. Mostrar nombres de etapa reales y progreso discreto; si hay spinner, no simular una duración conocida.
- Una animación importante a la vez; no repetir pulsos constantes ni loaders persistentes cuando una operación ya terminó.
- Si se recarga la página, reconstruir el estado real desde la API; no volver a reproducir una falsa secuencia histórica de trabajo.
- La confirmación `AUTORIZADA` solo aparece tras commit de autorización y reserva en PostgreSQL.
- Si una etapa falla y se reintenta, mostrar claramente `Reintentando etapa` y el número de intento, sin aparentar reinicio de todo el grafo.
- En `prefers-reduced-motion: reduce`, quitar líneas que se dibujan, desplazamientos y stagger; mantener resultado inmediato y señales estáticas.
- Suspender movimientos no críticos cuando la pestaña esté inactiva, siempre que sea aplicable; usar transform/opacity preferentemente; evitar medir/recalcular layout en cada fotograma.
- GSAP no debe ser requerido para que los controles funcionen. Timelines con limpieza al desmontar React (`useGSAP` o equivalente controlado).
- Accesibilidad: foco visible, ARIA live para cambios importantes con moderación, contraste WCAG 2.2 AA, teclado y alternativa textual a conexiones visuales.

## 9. Contratos visuales del negocio

- Los **seis estados de negocio** son `AUTORIZADA`, `EN_APROBACION`, `EN_CORRECCION`, `BLOQUEADA`, `RECHAZADA`, `ERROR`. No fusionarlos. `Procesando`/`En cola` son estados operativos del flujo.
- La autorización es **simulada** y debe decirlo. No mostrar `Dinero transferido`, ni botón de pago real.
- El resultado del motor determinista prevalece sobre cualquier descripción de un agente. Separar claramente `Hallazgo de IA` de `Validación de regla` y `Decisión final`.
- En detalle de factura, preservar y hacer visible el recorrido **documento → dato → contrato/cláusula → regla → evaluación → resultado**.
- Mostrar siempre importe y moneda original. Si existe FX, mostrar importe en moneda base, fuente, fecha y tasa utilizada. No inventar cotizaciones.
- Presupuestos global y por categoría son mensuales; la reserva corresponde al mes local de **autorización simulada**, sin contabilizar doble gasto.
- Aprobación humana en el MVP es **simulada**. La intervención humana debe disparar una nueva evaluación cuando corresponda; no ignorar bloqueos duros.
- Errores técnicos, ausencia de evidencia y reglas fallidas tienen mensajes, tratamientos y acciones de recuperación diferentes.
- Toda explicación visible debe poder respaldarse en `evaluation_checks`, `evaluation_evidence`, documentos y versiones; no presentar como hecho un razonamiento inventado.

## 10. Reglas responsive y de accesibilidad

- **Desktop ≥1280 px:** Evidence Studio con documento y evidencia lado a lado; navegación superior completa.
- **Tablet ~768–1279 px:** contenido prioritario y panel contextual colapsable; no forzar tres columnas estrechas.
- **Móvil <768 px:** lectura vertical del documento y hallazgos; barra superior compacta, acciones importantes visibles sin hover, tablas reordenadas con prioridad de información.
- Contraste como objetivo WCAG 2.2 AA: texto normal ≥4.5:1; elementos UI relevantes/foco ≥3:1; probar combinaciones antes de implementación.
- Área táctil cómoda, foco visible, formularios etiquetados, orden lógico de lectura, enlaces descriptivos y mensajes de error accionables.
- El dorado `#D6A357` **no** se usará como texto pequeño sobre blanco; reservarlo para decoración/acentos con contraste adecuado.

## 11. Tokens CSS iniciales (propuesta)

```css
:root {
  --brand-navy: #153454;
  --brand-navy-deep: #0E293F;
  --brand-petrol: #0D6871;
  --brand-petrol-dark: #09545C;
  --brand-gold: #D6A357;
  --brand-petrol-soft: #D9EEEA;
  --canvas: #F7F9FB;
  --paper: #FFFFFF;
  --ink: #172A3C;
  --muted: #667789;
  --line: #DFE7EC;
  --line-weight: 1px;
  --space-unit: 8px;
  --focus-ring: #09545C;
  --font-display: "Manrope", system-ui, sans-serif;
  --font-ui: "Inter", system-ui, sans-serif;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
  }
}
```

El fragmento define tokens, no un componente terminado. El respeto al movimiento reducido deberá implementarse también en las timelines JS/GSAP y no solo en CSS.

## 12. Lista de aceptación para los wireframes v2.0

- [ ] La pantalla tiene una jerarquía propia, no una copia de cuadrícula SaaS.
- [ ] Máximo tres grupos de navegación superior; sin sidebar izquierdo.
- [ ] Predominan lienzo claro, márgenes amplios, líneas de 1 px y tipografía editorial.
- [ ] Azul principal `#153454`, petróleo `#0D6871`, dorado `#D6A357` solo como acento; sin azul eléctrico.
- [ ] En el detalle de factura la evidencia se entiende sin cambiar constantemente de pantalla.
- [ ] El PDF permanece legible; anotaciones y trazos son opcionales y nunca bloquean la interacción.
- [ ] Todas las animaciones se vinculan a hechos reales o son transiciones de interfaz breves.
- [ ] El cambio de estado conserva distinción entre Bloqueada, Rechazada, En corrección y Error.
- [ ] Se comunica con claridad que autorizaciones, aprobaciones y reservas son simuladas.
- [ ] Los datos monetarios indican moneda, fuente FX cuando aplique, y reglas verificables.
- [ ] Responsive, teclado, contraste y movimiento reducido están previstos en los diseños.
- [ ] Cada elemento visual destacado tiene una razón funcional; si no, se elimina.

## 13. Alcance y próxima entrega

**Esta guía v2.1 sustituye el lenguaje visual de los wireframes v1.0.** Las funcionalidades, arquitectura y modelo de datos siguen vigentes. El siguiente entregable será el **rediseño de wireframes v2.0** comenzando por Dashboard (AI Command Center), Detalle de factura (Evidence Studio) y Aprobaciones; a continuación se extenderá el mismo sistema al resto de las vistas.

