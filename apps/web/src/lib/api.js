/**
 * Cliente HTTP same-origin para la API Express.
 * - Sesión por cookie HttpOnly (el navegador la gestiona; nunca localStorage).
 * - Token CSRF en memoria, enviado como X-CSRF-Token en métodos que modifican estado.
 * - Errores normalizados (ApiError) con código, estado y requestId del backend.
 */
export class ApiError extends Error {
  constructor({ status, code, message, details, requestId }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
  get isNetwork() {
    return this.status === 0;
  }
}

let csrfToken = null;
const unauthorizedListeners = new Set();

export function setCsrfToken(token) {
  csrfToken = token ?? null;
}
export function onUnauthorized(fn) {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
const DEFAULT_TIMEOUT = 20000;

/** Mensajes en español para fallos de transporte/HTTP sin cuerpo útil. */
const GENERIC = {
  0: "No hay conexión con el servidor. Comprueba tu red e inténtalo de nuevo.",
  401: "Tu sesión no es válida o expiró.",
  403: "No tienes permiso para realizar esta acción.",
  404: "El recurso no existe o no pertenece a tu empresa.",
  409: "La operación entra en conflicto con el estado actual.",
  413: "El archivo o los datos exceden el tamaño permitido.",
  415: "Formato no admitido.",
  422: "Los datos no son válidos.",
  429: "Demasiadas solicitudes. Espera un momento antes de reintentar.",
  500: "Error interno del servidor.",
  503: "Servicio no disponible temporalmente.",
};

async function toApiError(res) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* cuerpo no JSON */
  }
  const e = body?.error ?? {};
  return new ApiError({
    status: res.status,
    code: e.code ?? `HTTP_${res.status}`,
    message: e.message ?? GENERIC[res.status] ?? GENERIC[500],
    details: e.details,
    requestId: e.requestId ?? res.headers.get("x-request-id") ?? undefined,
  });
}

function notifyUnauthorized(err) {
  for (const fn of unauthorizedListeners) fn(err);
}

/** Petición JSON. `body` objeto → JSON; Blob/File → binario con su tipo. */
export async function api(path, { method = "GET", body, headers = {}, signal, timeoutMs = DEFAULT_TIMEOUT, skipUnauthorizedHandler = false } = {}) {
  const h = { Accept: "application/json", ...headers };
  let payload;
  if (body instanceof Blob) {
    payload = body;
  } else if (body !== undefined) {
    h["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  if (!SAFE.has(method) && csrfToken) h["X-CSRF-Token"] = csrfToken;
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res;
  try {
    res = await fetch(path, { method, headers: h, body: payload, credentials: "same-origin", signal: combined });
  } catch (err) {
    if (signal?.aborted) throw err; // cancelación pedida por el componente
    const timedOut = timeout.aborted;
    throw new ApiError({ status: 0, code: timedOut ? "TIMEOUT" : "NETWORK", message: timedOut ? "La solicitud tardó demasiado. Inténtalo de nuevo." : GENERIC[0] });
  }
  if (res.status === 204) return null;
  if (!res.ok) {
    const err = await toApiError(res);
    if (res.status === 401 && !skipUnauthorizedHandler) notifyUnauthorized(err);
    throw err;
  }
  return res.json();
}

/**
 * Subida binaria con progreso REAL (XMLHttpRequest expone eventos de subida; fetch no).
 * Devuelve { promise, abort }.
 */
export function uploadFile(path, file, { onProgress, headers = {} } = {}) {
  const xhr = new XMLHttpRequest();
  const promise = new Promise((resolve, reject) => {
    xhr.open("POST", path);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("Content-Type", file.type);
    if (csrfToken) xhr.setRequestHeader("X-CSRF-Token", csrfToken);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.({ loaded: e.loaded, total: e.total });
    };
    xhr.onload = () => {
      let body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* sin JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body);
      const e = body?.error ?? {};
      const err = new ApiError({ status: xhr.status, code: e.code ?? `HTTP_${xhr.status}`, message: e.message ?? GENERIC[xhr.status] ?? GENERIC[500], details: e.details, requestId: e.requestId });
      if (xhr.status === 401) notifyUnauthorized(err);
      reject(err);
    };
    xhr.onerror = () => reject(new ApiError({ status: 0, code: "NETWORK", message: GENERIC[0] }));
    xhr.onabort = () => reject(new ApiError({ status: 0, code: "ABORTED", message: "Subida cancelada." }));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}
