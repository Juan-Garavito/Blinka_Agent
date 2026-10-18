import { AIProviderError } from "../agents/ai/types.js";
import { boundedGeminiFetch, GEMINI_SMOKE_MODEL, getGeminiModel } from "../integration/gemini-probe.js";

if (!process.env.GEMINI_API_KEY) {
  process.stdout.write(JSON.stringify({ status: "BLOCKED", missing: "GEMINI_API_KEY", requests: 0 }) + "\n");
  process.exitCode = 1;
} else {
  const session = boundedGeminiFetch(process.env.GEMINI_API_KEY);
  try {
    const model = await getGeminiModel(session.fetch, GEMINI_SMOKE_MODEL);
    process.stdout.write(JSON.stringify({ selected: GEMINI_SMOKE_MODEL, model, available: model.name === `models/${GEMINI_SMOKE_MODEL}` && model.generateContent, requests: session.requests }) + "\n");
  } catch (error) {
    process.stdout.write(JSON.stringify({ status: "BLOCKED", code: error instanceof AIProviderError ? error.code : "UNEXPECTED", reason: error instanceof AIProviderError ? error.message : "Consulta de modelos fallida; no se reintenta", requests: session.requests }) + "\n");
    process.exitCode = 1;
  }
}
