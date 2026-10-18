# @blinka/web

Frontend React + Vite + JavaScript de Blinka PayGuard AI. Ejecutar comandos desde la raíz.

- `npm run dev:web`: http://localhost:5173; proxy same-origin a la API local :4000.
- `npm run build`: compila backend y frontend. La API sirve `apps/web/dist` si existe.
- `npm test -w @blinka/web`: pruebas Vitest con jsdom.
- `PW_CHROME=/usr/bin/google-chrome-stable npm run e2e -w @blinka/web`: Chrome local,
  API + worker reales locales con IA FAKE y FX FIXTURE; seed demo requerido.
- `E2E_BASE_URL=http://localhost:4001 PW_CHROME=/usr/bin/google-chrome-stable npm run e2e -w @blinka/web -- journey.spec.js --project=desktop`:
  comprueba el recorrido contra el frontend compilado servido por una API local en :4001.

No se usan claves de IA en el navegador. Sesión HttpOnly, CSRF para mutaciones y errores con requestId.
Rutas, filtros y pestañas usan URL; valores financieros se formatean desde strings decimales.
Las capturas reproducibles están en `docs/implementation/evidence/frontend/`.
El banner móvil resume el entorno y permite desplegar los detalles de simulación.

El informe y los límites conocidos están en `docs/implementation/REPORTE_FRONTEND_P0.md`.

Los E2E reutilizan cookies de sesión solo en memoria por worker/proyecto. Si hay HTTP 429
al iniciar sesión, respetar Retry-After y esperar la ventana configurada; no desactivar
los límites ni limpiar sus contadores.
