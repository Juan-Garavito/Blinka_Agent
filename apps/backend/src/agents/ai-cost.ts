import { D } from "../shared/money.js";

export interface AiPricing {
  inputUsdPerMTok: string;
  outputUsdPerMTok: string;
}

/**
 * Coste ESTIMADO de lista (USD, 8 decimales, aritmética decimal). `outputTokens` ya incluye los tokens de
 * pensamiento (se facturan como salida). Única fuente para ai_usage_logs y para el smoke real: los precios
 * vienen del perfil (AI_PRICE_*), nunca de constantes de un modelo concreto.
 */
export function estimateAiCostUsd(usage: { inputTokens: number; outputTokens: number }, pricing: AiPricing): string {
  return new D(usage.inputTokens).times(pricing.inputUsdPerMTok).plus(new D(usage.outputTokens).times(pricing.outputUsdPerMTok)).div(1_000_000).toDecimalPlaces(8).toFixed(8);
}
