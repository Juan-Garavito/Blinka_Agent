import { AIProviderError, type AIProvider, type AIRequest, type AIResponse } from "./types.js";

export type FakeStep = AIResponse | AIProviderError | ((req: AIRequest) => AIResponse | AIProviderError);

/** Marcador de fixture en documentos FICTICIOS de prueba/demo: `%BLINKA-FIXTURE:<base64 JSON>`. */
export const FIXTURE_MARKER = "%BLINKA-FIXTURE:";

/**
 * Proveedor de IA SIMULADO — SOLO pruebas y demo local. Nunca se presenta como
 * Gemini ni como IA real: name = "FAKE (MOCK)", isSimulated = true y así queda
 * registrado en ai_usage_logs.
 * - Con `script`: devuelve las respuestas/errores programados (pruebas).
 * - Sin script: lee el marcador de fixture embebido en el documento ficticio;
 *   sin marcador responde UNREADABLE.
 */
export class FakeAIProvider implements AIProvider {
  readonly name = "FAKE (MOCK)";
  readonly model = "fake-extractor-v1";
  readonly isSimulated = true;
  readonly calls: AIRequest[] = [];

  constructor(private readonly script: FakeStep[] = []) {}

  generate(req: AIRequest): Promise<AIResponse> {
    this.calls.push(req);
    const step = this.script.shift();
    if (step !== undefined) {
      const out = typeof step === "function" ? step(req) : step;
      return out instanceof AIProviderError ? Promise.reject(out) : Promise.resolve(out);
    }
    return Promise.resolve({ kind: "final", json: FakeAIProvider.fromDocument(req), usage: { inputTokens: 1200, outputTokens: 300 } });
  }

  static fromDocument(req: AIRequest): unknown {
    for (const m of req.messages) {
      if (m.role !== "user") continue;
      for (const p of m.parts) {
        if (!("inlineData" in p)) continue;
        const text = Buffer.from(p.inlineData.data, "base64").toString("latin1");
        const idx = text.indexOf(FIXTURE_MARKER);
        if (idx >= 0) {
          const b64 = text.slice(idx + FIXTURE_MARKER.length).split(/\s/)[0]!;
          return JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as unknown;
        }
      }
    }
    return { documentKind: "UNREADABLE", billingType: "UNKNOWN", lines: [], evidence: [], warnings: ["documento sin datos legibles (fixture)"] };
  }
}
