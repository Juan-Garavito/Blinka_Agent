import { describe, expect, it } from "vitest";
import { BudgetedAIProvider } from "../../src/agents/ai/budget.js";
import { AIProviderError, type AIProvider, type AIRequest } from "../../src/agents/ai/types.js";

const req = {} as AIRequest;
const argon = { inputUsdPerMTok: "2.00", outputUsdPerMTok: "10.00" };
const inner = (usage = { inputTokens: 1500, outputTokens: 900 }): AIProvider & { calls: number } => ({
  name: "GEMINI", model: "gemini-4-argon", isSimulated: false, calls: 0,
  generate() { this.calls++; return Promise.resolve({ kind: "final" as const, json: {}, usage }); },
});

describe("tope duro por proceso para IA real", () => {
  it("corta por número de solicitudes con error NO reintentable y sin llamar al proveedor", async () => {
    const p = inner();
    const b = new BudgetedAIProvider(p, { maxRequests: 2, maxCostUsd: "1" }, argon);
    await b.generate(req);
    await b.generate(req);
    const err = await b.generate(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AIProviderError);
    expect(err).toMatchObject({ code: "BUDGET_EXCEEDED", retryable: false });
    expect(p.calls).toBe(2);
  });
  it("corta por coste estimado acumulado con los precios del perfil (decimal)", async () => {
    const p = inner({ inputTokens: 10_000, outputTokens: 5_000 }); // 0.02 + 0.05 = 0.07 USD por llamada
    const b = new BudgetedAIProvider(p, { maxRequests: 10, maxCostUsd: "0.10" }, argon);
    await b.generate(req);
    expect(b.spent).toEqual({ requests: 1, estimatedCostUsd: "0.07000000" });
    await b.generate(req); // 0.14 ≥ 0.10 tras la segunda
    await expect(b.generate(req)).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
    expect(p.calls).toBe(2);
  });
  it("cuenta el uso conocido de llamadas fallidas", async () => {
    const failing: AIProvider = { name: "GEMINI", model: "m", isSimulated: false, generate: () => Promise.reject(new AIProviderError("INVALID_RESPONSE", false, "x", { inputTokens: 1000, outputTokens: 1000 })) };
    const b = new BudgetedAIProvider(failing, { maxRequests: 5, maxCostUsd: "1" }, argon);
    await b.generate(req).catch(() => undefined);
    expect(b.spent).toEqual({ requests: 1, estimatedCostUsd: "0.01200000" });
  });
});
