import { describe, expect, it } from "vitest";
import { MAX_BYTES, validateFile } from "../src/pages/invoices/InvoiceNew.jsx";
import { emptyVersion, toPayload, validateVersion } from "../src/pages/contracts/VersionEditor.jsx";
import { shiftPeriod } from "../src/pages/Budgets.jsx";
import { ratioPermille, trimZeros } from "../src/lib/format.js";

const file = (type, size) => ({ type, size, name: "f" });

describe("validación local del documento (el servidor vuelve a validar)", () => {
  it("acepta PDF/PNG/JPEG dentro del límite", () => {
    expect(validateFile(file("application/pdf", 1000))).toBeNull();
    expect(validateFile(file("image/jpeg", MAX_BYTES))).toBeNull();
  });
  it("rechaza otros formatos, vacíos y archivos grandes", () => {
    expect(validateFile(file("image/gif", 10))).toMatch(/Formato/);
    expect(validateFile(file("application/pdf", 0))).toMatch(/vacío/);
    expect(validateFile(file("application/pdf", MAX_BYTES + 1))).toMatch(/máximo/);
    expect(validateFile(null)).toMatch(/Selecciona/);
  });
});

describe("contratos por modalidad", () => {
  it("HOURLY exige tarifa y vigencia; el payload lleva unidad HOUR y sin campos vacíos", () => {
    const v = emptyVersion("HOURLY");
    expect(Object.keys(validateVersion("HOURLY", v))).toEqual(expect.arrayContaining(["effectiveFrom", "i0code", "i0unitPrice"]));
    const ok = { ...v, effectiveFrom: "2026-01-01", items: [{ code: "DEV", description: "Desarrollo", unitPrice: "30" }] };
    expect(validateVersion("HOURLY", ok)).toEqual({});
    expect(toPayload("HOURLY", ok)).toEqual({ currency: "USD", effectiveFrom: "2026-01-01", billingFrequency: "MONTHLY", items: [{ kind: "HOURLY_RATE", code: "DEV", description: "Desarrollo", unitPrice: "30", unit: "HOUR" }] });
  });
  it("RECURRING exige importe por período > 0 (sin coma flotante) y detecta códigos duplicados", () => {
    const v = { ...emptyVersion("RECURRING"), effectiveFrom: "2026-01-01", fixedPeriodAmount: "0.00" };
    expect(validateVersion("RECURRING", v).fixedPeriodAmount).toBeTruthy();
    const dup = { ...v, fixedPeriodAmount: "100", items: [{ code: "A", description: "x", agreedAmount: "1" }, { code: "A", description: "y", agreedAmount: "1" }] };
    expect(validateVersion("RECURRING", dup).i1code).toMatch(/duplicado/);
  });
});

describe("utilidades", () => {
  it("períodos y proporciones con enteros", () => {
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12");
    expect(shiftPeriod("2026-12", 1)).toBe("2027-01");
    expect(ratioPermille("3245.0000", "100000.0000")).toBe(32);
    expect(ratioPermille("900", "500")).toBe(1000);
    expect(ratioPermille("1", "0")).toBe(0);
    expect(trimZeros("100000.0000")).toBe("100000");
    expect(trimZeros("12.5000")).toBe("12.5");
    expect(trimZeros("100")).toBe("100");
  });
});
