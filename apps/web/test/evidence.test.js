import { describe, expect, it } from "vitest";
import { segmentText } from "../src/pages/invoices/detail/highlight.js";
import { evidenceFieldOfRule, fieldLabel, ruleLabel } from "../src/pages/invoices/detail/rules.js";
import { valueOf } from "../src/pages/invoices/detail/EvidenceStudio.jsx";

describe("resaltado de evidencias por rangos reales", () => {
  const text = "TOTAL A PAGAR: USD 1,200.00";
  it("segmenta por rangos y conserva el texto íntegro", () => {
    const segs = segmentText(text, [{ id: "currency", start: 15, end: 18 }, { id: "totalAmount", start: 19, end: 27 }]);
    expect(segs.map((s) => s.text).join("")).toBe(text);
    expect(segs.find((s) => s.ids.includes("currency")).text).toBe("USD");
    expect(segs.find((s) => s.ids.includes("totalAmount")).text).toBe("1,200.00");
  });
  it("rangos solapados: el tramo común lleva ambos campos", () => {
    const segs = segmentText("DEV 40 x 30.00 = 1,200.00", [{ id: "subtotal", start: 17, end: 25 }, { id: "lines[1].subtotal", start: 17, end: 25 }]);
    expect(segs.at(-1).ids).toEqual(["subtotal", "lines[1].subtotal"]);
  });
  it("ignora rangos inválidos o fuera del texto (no inventa posiciones)", () => {
    const segs = segmentText("abc", [{ id: "x", start: null, end: null }, { id: "y", start: 2, end: 10 }, { id: "z", start: 2, end: 1 }]);
    expect(segs).toEqual([{ text: "abc", ids: [] }]);
  });
});

describe("campos y reglas", () => {
  it("mapea reglas EVIDENCE_* al campo de evidencia", () => {
    expect(evidenceFieldOfRule("EVIDENCE_TOTAL_AMOUNT")).toBe("totalAmount");
    expect(evidenceFieldOfRule("EVIDENCE_LINE_1_UNIT_PRICE")).toBe("lines[1].unitPrice");
    expect(evidenceFieldOfRule("EVIDENCE_MISSING")).toBeNull();
    expect(evidenceFieldOfRule("HOURLY_CAP")).toBeNull();
  });
  it("etiquetas legibles con respaldo al código", () => {
    expect(fieldLabel("lines[2].quantity")).toBe("Línea 2 · cantidad");
    expect(ruleLabel("EVIDENCE_SUPPLIER_INVOICE_NUMBER")).toBe("Evidencia · Número de factura");
    expect(ruleLabel("UNKNOWN_RULE_X")).toBe("UNKNOWN_RULE_X");
    // El tope de gasto de IA no se confunde con el presupuesto financiero (BUDGET_GLOBAL/BUDGET_CATEGORY).
    expect(ruleLabel("PIPELINE_AI_SPEND_LIMIT")).toBe("Tope de gasto de IA del proceso alcanzado");
    expect(ruleLabel("PIPELINE_BUDGET_EXCEEDED")).toBe("Tope de gasto de IA del proceso alcanzado");
    expect(ruleLabel("PIPELINE_FOO")).toBe("Error técnico del análisis (FOO)");
    expect(ruleLabel("BUDGET_CATEGORY")).toBe("Presupuesto de la categoría");
  });
  it("valor de la versión evaluada para cada campo", () => {
    const v = { originalCurrency: "USD", totalAmount: "300.0000", paymentDestinationRaw: "Transferir a X", lines: [{ lineNo: 1, unitPrice: "30.000000" }] };
    expect(valueOf(v, "currency")).toBe("USD");
    expect(valueOf(v, "paymentAccount")).toBe("Transferir a X");
    expect(valueOf(v, "lines[1].unitPrice")).toBe("30.000000");
    expect(valueOf(v, "lines[9].unitPrice")).toBeNull();
  });
});
