# Reporte frontend P0 — Blinka PayGuard AI

Fecha: 18-10-2026. Estado: **FE0–FE5 completados y verificados localmente**, con los límites descritos abajo. No se hicieron commits, push ni despliegues. No se modificaron Supabase ni bases remotas y no se invocó Gemini real.

## Entrega FE0–FE5

| Paquete | Resultado |
|---|---|
| FE0 | Workspace React + Vite + JavaScript, tokens, componentes reutilizables, sesión, navegación protegida y cliente API same-origin con CSRF. |
| FE1 | Dashboard operativo: atención, procesamiento, presupuesto mensual y uso de IA; acceso a Nueva factura y guía de componentes desde el menú de usuario. |
| FE2 | Facturas con filtros/paginación en URL; proveedor obligatorio con búsqueda y explicación de su estado; validación de archivos, progreso real de carga, soporte horario opcional, creación y análisis con polling. |
| FE3 | Detalle con Resumen, Investigación, Evidencia e Historial direccionables; corrección versionada; texto original con rangos reales; confirmación humana de documentos sin texto seguida de reanálisis. |
| FE4 | Aprobaciones simuladas con motivo, confirmación y resultado de reevaluación; proveedores/cuentas, contratos/versiones, políticas/matriz, presupuestos, auditoría, consumo IA y configuración. |
| FE5 | Banner móvil compacto, capturas y recorridos responsive, pruebas adicionales, build servido por Express, Docker/Railway preparados y documentación de operación actualizada. |

En FE5 se eliminó también el cruce de aprobaciones contra las primeras 100 facturas: el endpoint devuelve `vendorName` y `supplierInvoiceNumber` de la versión solicitada, con joins por empresa. La prueba de integración comprueba estos campos y conserva las garantías de resolución, reevaluación y reserva única.

## Inventario de rutas y endpoints

Todos los endpoints indicados son de la API local existente; los formularios usan sus operaciones reales.

| Ruta | Endpoints principales |
|---|---|
| `/login` y sesión global | GET `/api/auth/session`; POST `/api/auth/login`, `/api/auth/logout` |
| `/` | GET `/api/dashboard`, `/api/invoices` con filtros de atención/procesamiento, `/api/approval-requests`, `/api/categories` |
| `/invoices` | GET `/api/invoices` con filtros, orden, limit/offset; GET `/api/vendors` |
| `/invoices/new` | GET `/api/vendors`, `/api/contracts`; POST `/api/documents?kind=INVOICE`, `/api/invoices`, documento EVIDENCE y `/api/invoices/:id/attachments`; POST `/api/invoices/:id/analysis` |
| `/invoices/:id` (Resumen) | GET factura/versiones, `/api/invoices/:id/evaluations`, `/api/invoices/:id/approval-requests`; POST análisis |
| `/invoices/:id/investigation` | GET `/api/evaluation-runs/:id`, `/api/evaluation-runs/:id/evidence`, `/api/ai-usage?evaluationRunId=…` |
| `/invoices/:id/evidence` | GET evidencia, `/api/documents/:id`, `/text`, `/content`; POST `/api/invoices/:id/versions/:versionId/confirmations` y reanálisis |
| `/invoices/:id/history` | GET `/api/audit-events` filtrado por factura y versiones/evaluaciones del detalle |
| `/invoices/:id/correct` | POST documento, `/api/invoices/:id/versions` y análisis |
| `/approvals` | GET `/api/approval-requests?status=…`, evaluaciones; POST `/api/approval-requests/:id/resolve` |
| `/vendors`, `/vendors/:id` | GET/POST `/api/vendors`; GET detalle; POST estado, cuentas bancarias y estado de cuenta |
| `/contracts`, `/contracts/new`, `/contracts/:id` | GET/POST `/api/contracts`, GET detalle, POST versiones y confirm/reject; GET proveedores y categorías |
| `/policies`, `/policies/:id` | GET/POST `/api/policies`, versiones y política activa; GET personas aprobadoras, categorías, proveedores y contratos |
| `/budgets` | GET `/api/budgets`, `/api/budgets/reservations`, `/api/categories`; POST `/api/budgets` |
| `/audit`, `/audit/ai-usage` | GET `/api/audit-events`, `/api/ai-usage`, `/api/evaluation-runs/:id` |
| `/settings` | GET `/api/companies/current`, `/api/system/environment`; GET/POST/PATCH categorías y personas aprobadoras |
| `/style-guide` | Componentes y tokens del frontend, sin persistencia ficticia |
| Shell global | GET `/api/system/environment`, datos de sesión; banner de simulación y navegación |

## Verificación ejecutada

- `npm run lint`: ambos workspaces pasan.
- `npm run typecheck`: backend pasa; el frontend es JavaScript y se valida con ESLint, Vitest y build.
- `npm run build`: backend TypeScript y frontend Vite pasan desde la raíz.
- `npm test -w @blinka/web`: **14/14**; cliente API/CSRF/errores, formato decimal, redirección segura, estados y evidencia. Las cuatro pruebas nuevas cubren solapamientos, rangos inválidos, texto vacío y valores por número real de línea.
- `npm test -w @blinka/backend`: **244/244**, 30 archivos. Incluye cinco casos nuevos de serving del frontend y la ampliación del contrato de aprobaciones. Se usó exclusivamente la base local de pruebas.
- E2E contra **frontend compilado servido por Express :4001**, API y worker locales reales, PostgreSQL local, IA FAKE (MOCK), FX FIXTURE: **9/9** en la suite final consolidada: cinco desktop, una tableta y tres móvil (44,8 s).
- Ampliación responsive: recorrido general de diez páginas en tableta (820×1180) y móvil Pixel 7, más los dos recorridos de factura en móvil. Todos pasan en la suite final. Los resultados de cierre se guardan en `evidence/frontend-verification.txt`.
- `npm ls --depth=0`: árbol instalado revisado sin dependencias inválidas. FE5 no añadió paquetes ni cambió el lockfile. No se realizó una auditoría de vulnerabilidades contra un registro externo.

Los recorridos automatizados verifican:

1. Dashboard sin formulario de carga → Nueva factura → selección obligatoria de Alfa → PDF + hoja de horas → worker real → Autorizada y reserva simulada → Total resaltado en sus caracteres reales → Investigación conservada al recargar.
2. Total del documento distinto de la extracción → En corrección, enlace al campo discrepante y ausencia de botón de aprobar.
3. Factura de 6000 USD → En aprobación → motivo insuficiente rechazado → aprobar mediante diálogo → resultado explícito de reevaluación. El backend también prueba dos resoluciones concurrentes con una sola reserva.
4. PNG válido generado para la prueba, sin capa de texto → En corrección → original cargado visualmente → confirmación deshabilitada hasta motivo y revisión → reanálisis → Autorizada y evidencia HUMAN_CONFIRMED.
5. Diez páginas principales sin desbordamiento horizontal, errores de consola ni excepciones JavaScript, con capturas y navegación móvil. Las rutas verificadas son Dashboard, Facturas, Nueva factura, Aprobaciones, Proveedores, Contratos, Políticas, Presupuestos, Auditoría y Configuración.

Las pruebas iniciales detectaron problemas de visibilidad del banner y aserciones que se corrigieron antes del cierre. La captura de errores de consola se inicia después del login, pues la consulta inicial de sesión sin autenticar devuelve 401 de forma esperada. Repetir suites completas alcanzó el límite real de login por IP (20/15 minutos): se respetó su expiración y se corrigió el helper para reutilizar cookies solo en memoria por worker/proyecto y reportar HTTP/Retry-After inmediatamente. No se cambiaron los límites ni sus contadores. El caso de aprobación usa 200 horas de Alfa, con hoja de horas del mismo importe horario; se comprobó capacidad disponible antes del cierre. Un proceso anterior en :4000 seguía sirviendo el contrato antiguo de aprobaciones; la verificación final completa se hizo sobre el build actualizado en :4001. No se contabilizan los intentos fallidos como verificaciones exitosas.

## Evidencias visuales y accesibilidad

Capturas reproducibles en `docs/implementation/evidence/frontend/`:

- `dashboard-`, `facturas-`, `nueva-factura-`, `aprobaciones-`, `proveedores-`, `contratos-`, `politicas-`, `presupuestos-`, `auditoria-`, `configuracion-`: variantes desktop, mobile y tablet.
- `02-nueva-factura-*`, `03-decision-autorizada-*`, `04-evidencia-*`: recorrido principal desktop/mobile.
- `05-aprobacion-desktop.png`, `06-confirmacion-desktop.png`: resoluciones simuladas y confirmación humana.

Se revisaron visualmente capturas móviles del Dashboard y de Evidencia. El banner mantiene visibles demo, ausencia de pagos, IA y FX; los detalles se despliegan al tocarlo. Estados con texto y explicación, etiquetas de formularios, enlace de salto, foco de título al navegar, diálogo nativo con foco y Escape, y menú móvil con foco inicial y cierre al navegar. Los tokens y GSAP respetan `prefers-reduced-motion`. No se afirma una certificación WCAG ni una auditoría exhaustiva de lectores de pantalla o de todos los navegadores.

## Operaciones reales, simuladas y límites

**Reales en local:** autenticación, aislamiento de empresa, persistencia PostgreSQL, archivos, subida y progreso, cola Graphile/worker, extracción de texto, posiciones de evidencia, confirmación humana auditada, evaluaciones deterministas, formularios de administración, auditoría y consultas de uso.

**Simuladas y rotuladas:** respuestas de IA FAKE (MOCK), FX FIXTURE en estos E2E, personas aprobadoras, autorizaciones y reservas presupuestarias. Ninguna acción ejecuta pagos. El consumo del proveedor fake no representa una factura de Gemini.

**Límites restantes:**

- El escenario O del seed anterior contiene solo cabecera PNG y marcador ficticio: su original sigue siendo inválido y puede verse como imagen rota. No se reescribió el documento inmutable ni se reseedearon datos existentes. El E2E usa un PNG válido y demuestra la confirmación completa independientemente de esa fixture defectuosa.
- Configuración de empresa es de solo lectura: falta endpoint de edición de empresa. Categorías y personas aprobadoras sí tienen operaciones reales.
- Gemini, Supabase y despliegue Railway no fueron verificados en FE5. El Dockerfile y los archivos Railway quedan preparados; no se construyó una imagen Docker nueva ni se desplegó.
- Los E2E usan la demo de octubre de 2026 y crean registros/reservas simuladas. Las repeticiones consumen presupuesto y horas; requieren datos demo compatibles y capacidad disponible. No eliminan datos para pasar.
- Responsive y teclado tienen cobertura dirigida; los formularios administrativos completos no cuentan todos con un E2E de mutación.

## Producción y operación local

Express sirve `apps/web/dist` si existe: fallback de rutas de React, HTML `no-cache`, assets con hash inmutables, API y archivos inexistentes conservan 404. Helmet mantiene CSP same-origin. El worker sigue separado. El Dockerfile compila ambos workspaces y copia el frontend a runtime; `.dockerignore` lo incluye y Railway observa también cambios de `apps/web`.

El smoke de producción aquí significa **artefacto compilado servido directamente por Express**, con NODE_ENV=development y cookies locales para HTTP. No sustituye una verificación de TLS, cookies Secure ni una ejecución remota de producción. Configuración HTTPS/ALLOWED_ORIGINS/TRUST_PROXY y comandos completos: `RUNBOOK.md`.

```bash
npm run dev:api
npm run dev:worker   # otra terminal
npm run dev:web      # otra terminal; http://localhost:5173
npm run build
PW_CHROME=/usr/bin/google-chrome-stable npm run e2e -w @blinka/web
```

Para verificar el build directamente, desde `apps/backend`:

```bash
PORT=4001 ALLOWED_ORIGINS=http://localhost:4001 node --env-file=.env dist/server.js
```

Desde la raíz:

```bash
E2E_BASE_URL=http://localhost:4001 PW_CHROME=/usr/bin/google-chrome-stable npm run e2e -w @blinka/web
```

Credenciales locales desde el `.env` ignorado o `E2E_EMAIL`/`E2E_PASSWORD`; no se imprimen ni se guardan en capturas. No hay claves de IA en el navegador.

## Decisiones visuales de la implementación

Interfaz operativa de superficies claras, azul marino/petróleo y acento dorado; Manrope para títulos e Inter para lectura, servidas localmente. Dashboard con lista de atención prioritaria y métricas mensuales, carga en una página independiente. Evidencia con documento y campos relacionados, badges explícitos, importes tabulares desde strings decimales y navegación por pestañas enlazables. Movimiento breve en contenido y selección de evidencia, subordinado a la preferencia de movimiento reducido. Guía reutilizable en `/style-guide`; decisiones técnicas D-053–D-058 en `DECISIONS.md`.
