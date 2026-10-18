import { AIProviderError } from "../agents/ai/types.js";

/** Modelo EXPLÍCITO del perfil (.env.gemini → GEMINI_MODEL); sin alias ni fallback automático. */
export const GEMINI_SMOKE_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";

/** Límite TOTAL: incluye listado y generaciones; se cierra ante CUALQUIER fallo.
 * No hay retries, paginación automática, API key en URL ni logging de cuerpos. */
export function boundedGeminiFetch(apiKey: string, fetchImpl: typeof fetch = fetch, maxRequests = 10) {
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 10) throw new Error("Presupuesto de solicitudes inválido");
  let requests = 0;
  let stopped = false;
  let lastFailure: { httpStatus: number } | undefined;
  const guarded: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (stopped || requests >= maxRequests) throw new AIProviderError("BAD_REQUEST", false, "Smoke detenido o límite global de 10 solicitudes alcanzado");
    if (url.origin !== "https://generativelanguage.googleapis.com" || url.search) throw new AIProviderError("BAD_REQUEST", false, "Destino Gemini no permitido en el smoke");
    requests++;
    try {
      const response = await fetchImpl(url, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), "x-goog-api-key": apiKey }, signal: init?.signal ?? AbortSignal.timeout(30_000), redirect: "error" });
      if (!response.ok) {
        stopped = true;
        lastFailure = { httpStatus: response.status };
        // Google también devuelve 400 API_KEY_INVALID. Solo clasificamos códigos,
        // jamás guardamos el mensaje/cuerpo del proveedor (puede incluir datos).
        const body = await response.json().catch(() => null) as { error?: { details?: Array<{ reason?: string }> } } | null;
        const keyRejected = body?.error?.details?.some((d) => d.reason === "API_KEY_INVALID") ?? false;
        throw new AIProviderError(response.status === 429 ? "RATE_LIMITED" : response.status === 401 || response.status === 403 || keyRejected ? "AUTH" : "BAD_REQUEST", false, `Smoke detenido por HTTP ${response.status}`);
      }
      return response;
    } catch (err) {
      stopped = true;
      if (err instanceof AIProviderError) throw err;
      throw new AIProviderError("UNAVAILABLE", false, "Smoke detenido por error de transporte");
    }
  };
  return { fetch: guarded, get requests() { return requests; }, get lastFailure() { return lastFailure; } };
}

/** Precio de lista (USD / 1M tokens, salida incluye pensamiento) verificado por modelo; el smoke exige coincidencia con el perfil. */
export const VERIFIED_PRICES: Record<string, { input: string; output: string; source: string }> = {
  "gemini-3.8-flash": { input: "0.75", output: "3.75", source: "https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash" },
  "gemini-4-argon": { input: "2.00", output: "10.00", source: "https://ai.google.dev/gemini-api/docs/latest-model (introductorio hasta 30-11-2026)" },
};

/** Disponibilidad EXACTA del modelo fijado (models.get, 1 GET, sin generación). El listado filtrado no sirve para modelos nuevos sin "flash". */
export async function getGeminiModel(fetchImpl: typeof fetch, model: string) {
  const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`);
  const data = await response.json() as { name?: string; supportedGenerationMethods?: string[] };
  return { name: data.name ?? null, generateContent: data.supportedGenerationMethods?.includes("generateContent") ?? false };
}

export async function listGeminiModels(fetchImpl: typeof fetch) {
  const response = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/models");
  const data = await response.json() as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }>; nextPageToken?: string };
  return {
    models: (data.models ?? []).filter((m) => /^models\/gemini-/.test(m.name) && !/preview|experimental|latest|tts|image/.test(m.name)).map((m) => ({ name: m.name, generateContent: m.supportedGenerationMethods?.includes("generateContent") ?? false })),
    truncated: Boolean(data.nextPageToken),
  };
}
