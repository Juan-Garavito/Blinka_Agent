import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { estimateAiCostUsd } from "../../src/agents/ai-cost.js";
import { VERIFIED_PRICES } from "../../src/integration/gemini-probe.js";

const argon = { inputUsdPerMTok: VERIFIED_PRICES["gemini-4-argon"]!.input, outputUsdPerMTok: VERIFIED_PRICES["gemini-4-argon"]!.output };

describe("coste estimado de IA (auditoría 18-10-2026)", () => {
  it("smoke Gemini 4 Argon: 17 606 entrada / 6 121 salida (incluye pensamiento) = 0.096422 USD", () => {
    expect(estimateAiCostUsd({ inputTokens: 17_606, outputTokens: 6_121 }, argon)).toBe("0.09642200");
  });
  it("no reproduce la subestimación con tarifas de otro modelo (0.75/3.75 → 0.036158)", () => {
    expect(estimateAiCostUsd({ inputTokens: 17_606, outputTokens: 6_121 }, { inputUsdPerMTok: "0.75", outputUsdPerMTok: "3.75" })).toBe("0.03615825");
    expect(estimateAiCostUsd({ inputTokens: 17_606, outputTokens: 6_121 }, argon)).not.toBe("0.03615825");
  });
  it("aritmética decimal exacta a 8 decimales y cero tokens", () => {
    expect(estimateAiCostUsd({ inputTokens: 1, outputTokens: 1 }, argon)).toBe("0.00001200");
    expect(estimateAiCostUsd({ inputTokens: 0, outputTokens: 0 }, argon)).toBe("0.00000000");
  });
  it("el smoke no contiene tarifas fijadas en código", () => {
    const src = readFileSync(new URL("../../src/scripts/gemini-smoke.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/\* ?0\.75|\* ?3\.75|\* ?2(\.0+)? \+|\* ?10(\.0+)? \)/);
    expect(src).toContain("estimateAiCostUsd");
  });
});
