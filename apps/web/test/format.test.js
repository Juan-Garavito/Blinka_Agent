import { describe, expect, it } from "vitest";
import { formatDate, formatDecimal, formatMoney, formatPeriod, formatRate } from "../src/lib/format.js";
import { safeNext } from "../src/pages/Login.jsx";

describe("formato financiero sin coma flotante", () => {
  it("formatea strings decimales del backend (es-CO) sin perder ni redondear información", () => {
    expect(formatDecimal("1200.0000")).toBe("1.200,00");
    expect(formatDecimal("4000000.00")).toBe("4.000.000,00");
    expect(formatDecimal("1085.5")).toBe("1.085,50");
    expect(formatDecimal("0.1234")).toBe("0,1234");
    // Más precisión que un double: se conserva intacta.
    expect(formatDecimal("9007199254740993.0100")).toBe("9.007.199.254.740.993,01");
    expect(formatDecimal("12.345678")).toBe("12,345678");
    expect(formatDecimal(null)).toBe("—");
    expect(formatMoney("960.0000", "USD")).toBe("960,00 USD");
  });
  it("tasas FX con todos sus decimales significativos", () => {
    expect(formatRate("0.000315411644")).toBe("0,000315411644");
    expect(formatRate("1.000000000000")).toBe("1");
  });
  it("fechas civiles sin desplazamiento de zona horaria y periodos", () => {
    expect(formatDate("2026-10-01")).toMatch(/1.*oct.*2026/i);
    expect(formatPeriod("2026-10")).toMatch(/octubre.*2026/i);
  });
});

describe("redirección segura tras login", () => {
  it("solo acepta rutas internas", () => {
    expect(safeNext("/invoices/abc")).toBe("/invoices/abc");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("/login")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});
