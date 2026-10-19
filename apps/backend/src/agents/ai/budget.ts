import { D } from "../../shared/money.js";
import { estimateAiCostUsd, type AiPricing } from "../ai-cost.js";
import { AIProviderError, type AIProvider, type AIRequest, type AIResponse } from "./types.js";

/**
 * Tope DURO por proceso para un proveedor real: antes de cada llamada comprueba nº de solicitudes y coste
 * estimado acumulado (mismos precios que ai_usage_logs). Al agotarse lanza un error NO reintentable: la
 * corrida termina en ERROR técnico y la cola no reintenta, así que ningún reintento puede superar el tope.
 */
export class BudgetedAIProvider implements AIProvider {
  private requests = 0;
  private costUsd = "0";

  constructor(
    private readonly inner: AIProvider,
    private readonly limits: { maxRequests: number; maxCostUsd: string },
    private readonly pricing: AiPricing,
  ) {}

  get name() {
    return this.inner.name;
  }
  get model() {
    return this.inner.model;
  }
  get isSimulated() {
    return this.inner.isSimulated;
  }
  get spent() {
    return { requests: this.requests, estimatedCostUsd: this.costUsd };
  }

  async generate(req: AIRequest): Promise<AIResponse> {
    if (this.requests >= this.limits.maxRequests || new D(this.costUsd).gte(this.limits.maxCostUsd)) {
      throw new AIProviderError(
        "AI_SPEND_LIMIT",
        false,
        `Tope de gasto de IA del proceso alcanzado (${this.requests}/${this.limits.maxRequests} llamadas, ${this.costUsd}/${this.limits.maxCostUsd} USD estimados). No es una decisión financiera: reinicia el worker o amplía AI_MAX_REQUESTS_PER_PROCESS / AI_MAX_COST_USD_PER_PROCESS y reanaliza.`,
      );
    }
    this.requests++;
    try {
      const res = await this.inner.generate(req);
      this.add(res.usage);
      return res;
    } catch (err) {
      if (err instanceof AIProviderError && err.usage) this.add(err.usage);
      throw err;
    }
  }

  private add(usage: { inputTokens: number; outputTokens: number }) {
    this.costUsd = new D(this.costUsd).plus(estimateAiCostUsd(usage, this.pricing)).toFixed(8);
  }
}
