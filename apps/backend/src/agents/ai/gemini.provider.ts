import { AIProviderError, type AIMessage, type AIModelContent, type AIProvider, type AIRequest, type AIResponse } from "./types.js";

/**
 * Adaptador Gemini (REST generateContent con `fetch` nativo).
 * - La API key viaja SOLO en la cabecera x-goog-api-key (nunca en URL ni logs).
 * - Documentos como inlineData (PDF/PNG/JPEG) y salida JSON validada después con Zod.
 * Verificación real y credenciales: ver REPORTE_P0_INTEGRATION_GEMINI_SUPABASE.md.
 */
export class GeminiProvider implements AIProvider {
  readonly name = "GEMINI";
  readonly isSimulated = false;

  constructor(
    private readonly cfg: { apiKey: string; model: string; baseUrl?: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get model() {
    return this.cfg.model;
  }

  private contents(messages: AIMessage[]) {
    return messages.map((m) => {
      if (m.role === "user") return { role: "user", parts: m.parts };
      if (m.role === "model_tool_calls") return m.modelContent ?? { role: "model", parts: m.calls.map((c) => ({ functionCall: { name: c.name, args: c.args } })) };
      return { role: "user", parts: m.results.map((r) => ({ functionResponse: { ...(r.providerId ? { id: r.providerId } : {}), name: r.name, response: { result: r.result } } })) };
    });
  }

  async generate(req: AIRequest): Promise<AIResponse> {
    const url = `${(this.cfg.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "")}/models/${encodeURIComponent(this.cfg.model)}:generateContent`;
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: this.contents(req.messages),
      generationConfig: {
        temperature: 0,
        maxOutputTokens: req.maxOutputTokens,
        // En pasos intermedios con herramientas no se fuerza JSON; en el paso final sí.
        ...(req.final || req.tools.length === 0 ? { responseMimeType: "application/json", responseJsonSchema: toGeminiSchema(req.responseJsonSchema) } : {}),
      },
      // Si el historial contiene functionCall/functionResponse, la API exige las declaraciones aunque ya no
      // se permitan llamadas: en el paso final se envían con mode NONE (antes se omitían → HTTP 400).
      ...(req.tools.length > 0 ? { tools: [{ functionDeclarations: req.tools }] } : {}),
      ...(req.tools.length > 0 && req.final ? { toolConfig: { functionCallingConfig: { mode: "NONE" } } } : {}),
    };
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.cfg.apiKey },
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (err) {
      if (err instanceof AIProviderError) throw err;
      const aborted = err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
      throw new AIProviderError(aborted ? "TIMEOUT" : "UNAVAILABLE", true, aborted ? "Tiempo de espera agotado" : "Proveedor de IA no disponible");
    }
    if (!res.ok) {
      const status = res.status;
      if (status === 429) throw new AIProviderError("RATE_LIMITED", true, "Límite de tasa del proveedor de IA");
      if (status >= 500) throw new AIProviderError("UNAVAILABLE", true, `Proveedor de IA no disponible (HTTP ${status})`);
      if (status === 401 || status === 403) throw new AIProviderError("AUTH", false, "Credenciales de IA rechazadas");
      // 400: petición o documento inválido (p. ej. PDF corrupto): defecto documental, no se reintenta.
      throw new AIProviderError("INVALID_DOCUMENT", false, `El proveedor rechazó el documento (HTTP ${status})`);
    }
    const data = (await res.json().catch(() => null)) as {
      candidates?: Array<{ finishReason?: string; content?: AIModelContent }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    } | null;
    const usage = { inputTokens: data?.usageMetadata?.promptTokenCount ?? 0, outputTokens: (data?.usageMetadata?.candidatesTokenCount ?? 0) + (data?.usageMetadata?.thoughtsTokenCount ?? 0) };
    const candidate = data?.candidates?.[0];
    if (candidate?.finishReason && candidate.finishReason !== "STOP") {
      throw new AIProviderError("INVALID_RESPONSE", false, "Generación incompleta o bloqueada; no se reintenta automáticamente", usage);
    }
    const parts = candidate?.content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall).map((p, i) => ({ id: p.functionCall!.id ?? `call-${i}`, ...(p.functionCall!.id ? { providerId: p.functionCall!.id } : {}), name: p.functionCall!.name, args: p.functionCall!.args ?? {} }));
    if (calls.length > 0) return { kind: "tool_calls", calls, usage, modelContent: { role: "model", parts } };
    const text = parts.filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    try {
      return { kind: "final", json: JSON.parse(text) as unknown, usage };
    } catch {
      throw new AIProviderError("INVALID_RESPONSE", false, "La respuesta del modelo no es JSON válido", usage);
    }
  }
}

/**
 * Subconjunto de JSON Schema aceptado por responseJsonSchema. Verificado 18-10-2026 con gemini-4-argon:
 * el esquema completo de Zod devolvía HTTP 400 INVALID_ARGUMENT y sin cotas numéricas (maxItems/minimum/maximum)
 * ni validaciones de texto devuelve 200. Solo afecta a la GUÍA enviada al modelo: Zod sigue validando
 * TODAS las restricciones de la respuesta (longitudes, patrones, fechas, rangos) antes de usarla.
 */
const UNSUPPORTED_SCHEMA_KEYS = new Set(["$schema", "pattern", "format", "default", "minLength", "maxLength", "minItems", "maxItems", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"]);
export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  return Object.fromEntries(
    Object.entries(schema as Record<string, unknown>)
      .filter(([k]) => !UNSUPPORTED_SCHEMA_KEYS.has(k))
      .map(([k, v]) => [k, k === "properties" && v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toGeminiSchema(pv)])) : toGeminiSchema(v)]),
  );
}
