# Blinka PayGuard AI — Plan de implementación backend para Claude

**Proyecto:** Hackaton 30X · **Versión:** 1.0 · **Fecha:** 18 de octubre de 2026  
**Objetivo:** iniciar el backend en paralelo al rediseño visual, sin anticipar decisiones de interfaz ni programar todo el sistema en un único lote.

## 1. Fuentes de verdad y precedencia

Antes de modificar código, leer y contrastar:

1. `Blinka_PayGuard_AI_Modelo_ER_v1_2.md` — 31 entidades conceptuales, relaciones y restricciones.
2. `Blinka_PayGuard_AI_Arquitectura_Logica_v1_1.md` — decisiones ARCH-001 a ARCH-012, inmutabilidad e idempotencia.
3. `Blinka_PayGuard_AI_Reglas_Diseno_v2_1.md` — solo para restricciones UX relevantes (no construir frontend en esta fase).
4. El estado **real** del repositorio y su documentación, que no debe asumirse vacío.

Si existe un conflicto entre documentación y código, reportarlo y proponer una resolución antes de editar. Priorizar las decisiones explícitamente confirmadas por el usuario. No inventar tablas, estados de factura ni flujos que contradigan estos documentos.

## 2. Decisiones tecnológicas acordadas

- **Backend:** Node.js + Express + TypeScript; arquitectura de monolito modular con Controllers/Services/Repositories.
- **Persistencia:** PostgreSQL alojado en Supabase; SQL vía Drizzle ORM y Drizzle Kit; validar entradas con Zod y reglas de integridad de PostgreSQL.
- **Colas:** Graphile Worker (PostgreSQL) en proceso `worker` separado, **mismo repositorio y código**, sin Redis ni servicios propietarios de Supabase Queues.
- **Agentes:** LangGraph.js con harness propio, tools restringidas y revisión de resultados; Gemini como primera IA, adaptador sustituible por OpenAI.
- **Documentos:** Supabase Storage privado, acceso encapsulado en un servicio de almacenamiento; no enlaces públicos permanentes.
- **Autenticación P0:** una cuenta evaluadora real mediante sesiones del servidor almacenadas en PostgreSQL, cookies HttpOnly/Secure/SameSite, hash Argon2id, controles CSRF/origen y rate limiting. Las personas aprobadoras son **simuladas** y NO son roles de login.
- **FX:** interfaz de servicio desacoplada; Frankfurter como candidato inicial gratuito, sujeto a validación del usuario. Las tasas reales y sus metadatos se guardan en `fx_rate_snapshots`; no las genera ningún LLM.
- **Frontend futuro:** React + Vite + JavaScript, consulta de progreso mediante polling; la implementación del diseño sigue en paralelo.
- **Despliegue:** Railway Hobby, imagen Docker portable, dos servicios `api` y `worker` del mismo repositorio, Docker Compose local, CI/CD desde GitHub cuando se autorice.
- **Sin Jev en P0**; no pagos reales; autorizaciones y reservas exclusivamente simuladas.

## 3. Invariantes que no pueden violarse

1. **Aislamiento:** toda operación de datos requiere `company_id` confiable, nunca aceptado ciegamente del LLM o frontend; las tools no reciben credenciales ni SQL libre.
2. **Dinero:** importes `NUMERIC`/decimal, nunca coma flotante de JavaScript para límites, tasas, reservas o acumulados.
3. **Decisión final:** exclusivamente `DecisionEngine` determinista; ningún modelo ni herramienta puede autorizar facturas, modificar políticas, cuentas bancarias o presupuestos.
4. **Control documental:** proveedor/cuenta autorizados, contrato vigente de modalidad compatible, evidencia verificable, duplicados y FX preceden cualquier autorización.
5. **Reserva segura:** una sola reserva por factura, con efecto en presupuesto global y categoría del **mes de autorización según `companies.timezone`**; ambas imputaciones se confirman en una sola transacción bajo bloqueos/idempotencia.
6. **Seis estados comerciales distintos:** `AUTORIZADA`, `EN_APROBACION`, `EN_CORRECCION`, `BLOQUEADA`, `RECHAZADA`, `ERROR`. Los estados de procesamiento del worker no son estados comerciales.
7. **Recuperación:** persistir intentos en `agent_stage_runs`, reintentar solo la etapa temporalmente fallida, reutilizar entradas idénticas, invalidar dependencias cambiadas, no volver a autorizar por duplicación de mensajes.
8. **Auditoría:** conservar versiones, evidencias, checks, políticas aplicadas, errores, llamadas de IA y eventos humanos; no almacenar secretos ni cadena de pensamiento privada.
9. **Sin perjuicio por falencias técnicas:** proveedor de IA/FX caído no permite una aprobación favorable; documento/evidencia insuficiente es corrección y un fallo técnico agotado es error.
10. **Seguridad de herramientas:** prompt de cada especialista + allowlist de tools + autorización backend/repositorio. Documentos externos son contenido no confiable.

## 4. Hoja de ruta por entregables revisables

| Paquete | Objetivo | Entregables de aceptación |
|---|---|---|
| **B0 — Fundación técnica** | Preparar ejecución local reproducible | Express TS; estructura modular; health/readiness; Drizzle config y migraciones controladas; Docker Compose Postgres local; arranque API y worker; Zod env; pruebas/lint; README. |
| **B1 — Identidad y ER** | Establecer base relacional y login | Migraciones progresivas y restricciones; usuario evaluador y empresa; sesión segura; pruebas de aislamiento, hashes y login. |
| **B2 — Gestión comercial y documental** | Proveedores, bancos, contratos, facturas y versiones | Servicios/repositorios; validaciones por modalidad; almacenamiento privado; detección de identidad duplicada; pruebas. |
| **B3 — Motor financiero** | Políticas, FX, presupuestos y autorizaciones | `DecisionEngine` determinista, snapshots FX, presupuesto mensual, reserva + asignaciones atómicas, concurrencia/idempotencia. |
| **B4 — Procesamiento con agentes** | Extracción y cotejo documentado | Harness, LangGraph.js, Gemini adapter, herramientas read-only, `agent_stage_runs`, checkpoints y colas con recuperación. |
| **B5 — Human-in-the-loop** | Aprobaciones simuladas, correcciones y auditoría | Solicitud/resolución en `approval_requests`, nueva evaluación sin eludir políticas, trazabilidad. |
| **B6 — Integración y entrega** | Conectar interfaz y Railway | API pública final según UX, polling, pruebas end-to-end, seguridad, observabilidad y CI/CD. |

**Regla:** implementar, probar y revisar un paquete a la vez. No anticipar endpoints o decisiones visuales que todavía no se hayan discutido. El paquete B0 solo expone endpoints técnicos mínimos; los contratos de negocio se diseñarán cuando corresponda.

## 5. Prompt para Claude — PRIMER PAQUETE B0

> Actúa como ingeniero backend senior responsable de la implementación inicial de Blinka PayGuard AI, un MVP de hackatón B2B con **autorizaciones financieras simuladas**. No desarrolles el frontend ni el motor de decisiones todavía.
>
> **Primero haz preflight de solo lectura:** inspecciona árbol Git, ramas, estado de cambios, scripts y dependencias existentes. Lee y resume los documentos ER v1.2, Arquitectura v1.1 y Diseño v2.1 adjuntos. Comprueba conflictos o vacíos técnicos y registra supuestos. No presupongas que el repositorio está vacío; preserva archivos y cambios existentes.
>
> **Implementa únicamente B0 — Fundación técnica** conforme a las decisiones: Node.js, Express, TypeScript, Drizzle, PostgreSQL, Zod, Graphile Worker y Docker Compose para desarrollo local. Prefiere APIs estándar de Node (`fetch`, `crypto`, `Intl`) donde tengan sentido. Mantén la estructura mínima y modular: `src/config`, `src/shared/db`, `src/shared/errors`, `src/modules`, `src/agents`, `src/jobs`, más entrypoints independientes `server` y `worker`. No fuerces un framework de inyección de dependencias ni capas abstractas vacías.
>
> 1. Inicializa o adapta un repositorio TypeScript reproducible con scripts claros: `dev`, `dev:worker`, `build`, `start`, `start:worker`, `typecheck`, `test`, `lint`, `db:generate`, `db:migrate` (nombres adaptables a la configuración real). Documenta el gestor de paquetes usado; si ya existe, respétalo.
> 2. Configura Express con manejo centralizado de errores, validación tipada del entorno con Zod, logging estructurado sin secretos y límites iniciales razonables para payloads. Implementa `GET /health` (liveness) y `GET /ready` (disponibilidad de PostgreSQL), sin rutas financieras ni endpoint de autorización.
> 3. Crea una base de datos PostgreSQL **local** en Docker Compose para pruebas. Configura Drizzle y su mecanismo versionado de migraciones **sin aplicar automáticamente ninguna migración a Supabase real**. Verifica que las conexiones a pruebas sean aisladas. Usa pool y cierre ordenado de conexiones.
> 4. Prepara la integración básica de Graphile Worker como proceso independiente `worker` que conecta a PostgreSQL y ofrece un handler de prueba inocuo. La cola no debe iniciar autorizaciones ni consumir Gemini. Implementa cierre limpio y evita reintentos peligrosos. No introduzcas Redis ni Supabase Queues.
> 5. Añade pruebas automatizadas de arranque, validación de entorno, health/readiness y ejecución de tarea inocua mediante cola local. Si una prueba requiere infraestructura externa, documenta cómo reproducirla y no simules que pasó.
> 6. Incluye `.env.example` sin valores reales, `.gitignore`, `Dockerfile` portable (si procede), `docker-compose.yml` local y README con comandos de instalación, pruebas, migraciones locales y arranque concurrente de API/worker. No configures aún Railway real.
>
> **Seguridad obligatoria:** antes de cualquier comando que pueda modificar/destruir datos, muestra objetivo de conexión, base y entorno; por defecto opera solo sobre PostgreSQL local. No ejecutar comandos destructivos o migraciones en datos remotos/compartidos sin autorización explícita, confirmación exacta del destino y auditoría. No insertar ni imprimir secretos; no `db push`, reset, drop, truncado o seed en producción. No realizar `git push` ni desplegar en Railway. No realizar commits sin autorización.
>
> **Entrega final requerida de B0:** resumen de estructura, dependencias y decisiones; lista exacta de archivos añadidos/modificados; comandos reproducibles; resultados reales de build, lint y tests (número de pruebas, fallos, evidencias); pruebas de arranque de API/worker; riesgos o desviaciones, y recomendación concreta para B1. Si no fue posible ejecutar algo, señalarlo abiertamente. No declare B0 cerrado si hay pruebas fallidas.
>
> **Límite del alcance:** no crear las 31 tablas ahora sin revisar el ER y sus restricciones; no crear endpoints CRUD masivos, login completo, integración Gemini real ni servicios financieros. Todo eso corresponde a paquetes posteriores. Si hay una ambigüedad significativa, elige la opción más conservadora documentándola y sigue con B0 sin bloquear el trabajo por decisiones visuales.

## 6. Criterios de revisión de B0 para ChatGPT

- API y worker arrancan como procesos separados desde el **mismo código** y con Docker Compose local.
- `GET /health` responde aun cuando una dependencia está caída; `/ready` detecta dependencia PostgreSQL sin exponer credenciales.
- Errores tipados, validación Zod, logs seguros, compilación TypeScript y pruebas repetibles.
- Migrations no se ejecutan contra Supabase ni se crean esquemas financieros incompletos por adelantado.
- Configuración de workers y de cola probada con tarea inocua; errores y shutdown observables.
- README suficiente para reproducir B0 sin credenciales privadas ni herramientas propietarias del hosting.
- No commits, push, ni despliegue realizados sin autorización.

**Próximo paso operativo:** entregar a Claude este documento, junto con ER v1.2 y Arquitectura lógica v1.1; pedir el informe del paquete B0 y someterlo a revisión técnica antes de comenzar B1.
