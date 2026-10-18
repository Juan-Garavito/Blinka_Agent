import { describe, expect, it } from "vitest";
import { segmentText } from "../src/pages/invoices/detail/highlight.js";
import { valueOf } from "../src/pages/invoices/detail/EvidenceStudio.jsx";

describe("evidencia en posiciones reales", () => {
  it("conserva el texto y ambos campos en rangos solapados", () => {
    const segments = segmentText("USD 300.00 total", [{ id: "currency", start: 0, end: 3 }, { id: "total", start: 4, end: 10 }, { id: "citation", start: 0, end: 10 }]);
    expect(segments.map((s) => s.text).join("")).toBe("USD 300.00 total");
    expect(segments.find((s) => s.text === "300.00").ids).toEqual(["total", "citation"]);
  });
  it("ignora posiciones ausentes, fraccionarias, negativas o fuera del documento", () => {
    expect(segmentText("abc", [ { id: "a", start: null, end: null }, { id: "b", start: -1, end: 2 }, { id: "c", start: 1, end: 4 }, { id: "d", start: 1.5, end: 2 }, { id: "e", start: 2, end: 1 } ])).toEqual([{ text: "abc", ids: [] }]);
  });
  it("no inventa texto en una página vacía", () => {
    expect(segmentText("", [])).toEqual([]);
  });
  it("resuelve líneas por lineNo y los nombres de campos del backend", () => {
    const version = { originalCurrency: "USD", paymentDestinationRaw: "Cuenta demo", lines: [{ lineNo: 2, subtotal: "300.00" }] };
    expect(valueOf(version, "currency")).toBe("USD");
    expect(valueOf(version, "paymentAccount")).toBe("Cuenta demo");
    expect(valueOf(version, "lines[2].subtotal")).toBe("300.00");
    expect(valueOf(version, "lines[1].subtotal")).toBeNull();
    expect(valueOf(null, "totalAmount")).toBeNull();
  });
});
