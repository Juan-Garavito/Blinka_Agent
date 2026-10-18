import { describe, expect, it } from "vitest";
import { buildTextPdf } from "../../src/modules/demo/simple-pdf.js";
import { extractTextLayer } from "../../src/modules/evidence/text-layer.js";
import { evidenceFieldsFor, evidenceRuleCode, parseDocumentNumber, verifyFields, type EvidenceField } from "../../src/modules/evidence/verifier.js";
import { PNG_BYTES } from "../helpers/fixtures.js";

const INVOICE_LINES = [
  "Alfa Software SAS - NIT 900.100.001-9",
  "FACTURA ELECTRONICA No. FAC-0001",
  "Fecha de emision: 10 de octubre de 2026",
  "Periodo de servicio: 01/10/2026 a 31/10/2026",
  "Contrato: CT-ALFA-2026",
  "DEV  Desarrollo  40 HOUR x 30.00 = 1,200.00",
  "Subtotal: 1,200.00",
  "IVA: 228.00",
  "TOTAL A PAGAR: USD 1,428.00",
  "Pagar a cuenta: CO98 7654 3210 1122",
];

const field = (f: Partial<EvidenceField> & Pick<EvidenceField, "field" | "kind" | "value">): EvidenceField => ({ critical: false, ...f });

describe("capa de texto (determinista, sin IA)", () => {
  it("PDF digital → TEXT con texto por página; imagen → NO_TEXT; PDF corrupto → UNPARSEABLE", async () => {
    const layer = await extractTextLayer("application/pdf", buildTextPdf([INVOICE_LINES, ["Anexo pagina 2"]]));
    expect(layer).toMatchObject({ status: "TEXT", detail: null });
    expect(layer.pages).toHaveLength(2);
    expect(layer.pages[0]).toContain("TOTAL A PAGAR: USD 1,428.00");
    expect(layer.textSha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await extractTextLayer("image/png", PNG_BYTES)).status).toBe("NO_TEXT");
    expect((await extractTextLayer("application/pdf", Buffer.from("%PDF-1.4\n% roto\n%%EOF\n"))).status).toBe("UNPARSEABLE");
    // PDF válido sin texto (escaneo simulado: página vacía).
    expect((await extractTextLayer("application/pdf", buildTextPdf([[]]))).status).toBe("NO_TEXT");
  });
});

describe("verificador de evidencias", () => {
  const layer = { status: "TEXT" as const, pages: [INVOICE_LINES.join("\n")] };

  it("verifica valores reales con página, posición y fragmento del documento", () => {
    const [num, total, cur, date, acct] = verifyFields(layer, [
      field({ field: "supplierInvoiceNumber", kind: "IDENTIFIER", value: "FAC-0001" }),
      field({ field: "totalAmount", kind: "TOTAL_AMOUNT", value: "1428.0000" }),
      field({ field: "currency", kind: "CURRENCY", value: "USD" }),
      field({ field: "issueDate", kind: "DATE", value: "2026-10-10" }),
      field({ field: "paymentAccount", kind: "IDENTIFIER", value: "CO98765432101122" }),
    ]);
    expect(num).toMatchObject({ status: "TEXT_VERIFIED", page: 1, excerpt: "FACTURA ELECTRONICA No. FAC-0001" });
    expect(layer.pages[0]!.slice(num!.start!, num!.end!)).toBe("FAC-0001");
    expect(total).toMatchObject({ status: "TEXT_VERIFIED", excerpt: "TOTAL A PAGAR: USD 1,428.00" });
    expect(layer.pages[0]!.slice(total!.start!, total!.end!)).toBe("1,428.00");
    expect(cur!.status).toBe("TEXT_VERIFIED");
    expect(date).toMatchObject({ status: "TEXT_VERIFIED", excerpt: "Fecha de emision: 10 de octubre de 2026" });
    expect(layer.pages[0]!.slice(acct!.start!, acct!.end!)).toBe("CO98 7654 3210 1122");
  });

  it("valores INVENTADOS → NOT_FOUND (importe, número, referencia, cuenta, fecha, moneda)", () => {
    const r = verifyFields(layer, [
      field({ field: "totalAmount", kind: "TOTAL_AMOUNT", value: "9999.00" }),
      field({ field: "supplierInvoiceNumber", kind: "IDENTIFIER", value: "FAC-0099" }),
      field({ field: "contractRefCited", kind: "IDENTIFIER", value: "CT-INVENTADO" }),
      field({ field: "paymentAccount", kind: "IDENTIFIER", value: "CO11112222333344" }),
      field({ field: "issueDate", kind: "DATE", value: "2026-10-11" }),
      field({ field: "currency", kind: "CURRENCY", value: "EUR" }),
    ]);
    expect(r.map((x) => x.status)).toEqual(Array(6).fill("NOT_FOUND"));
  });

  it("el total exige contexto de TOTAL: el subtotal o una línea no lo 'verifican'", () => {
    // 1200 aparece como subtotal y como línea, pero no en la línea de TOTAL.
    expect(verifyFields(layer, [field({ field: "totalAmount", kind: "TOTAL_AMOUNT", value: "1200" })])[0]!.status).toBe("NOT_FOUND");
    expect(verifyFields(layer, [field({ field: "subtotal", kind: "AMOUNT", value: "1200" })])[0]!.status).toBe("TEXT_VERIFIED");
    // Total en la línea siguiente a la etiqueta (tablas).
    const twoLines = { status: "TEXT" as const, pages: ["Total a pagar\nUSD 1.428,00"] };
    expect(verifyFields(twoLines, [field({ field: "totalAmount", kind: "TOTAL_AMOUNT", value: "1428" })])[0]!.status).toBe("TEXT_VERIFIED");
  });

  it("límites de palabra: FAC-0001 no verifica FAC-001 ni FAC-00011; '001' de un número de factura no es el importe 1", () => {
    const r = verifyFields(layer, [
      field({ field: "a", kind: "IDENTIFIER", value: "FAC-001" }),
      field({ field: "b", kind: "IDENTIFIER", value: "FAC-00011" }),
      field({ field: "c", kind: "AMOUNT", value: "1" }),
    ]);
    expect(r.map((x) => x.status)).toEqual(["NOT_FOUND", "NOT_FOUND", "NOT_FOUND"]);
  });

  it("formatos numéricos sin ambigüedad decimal", () => {
    expect(parseDocumentNumber("1,200.00")).toBe("1200.00");
    expect(parseDocumentNumber("1.200,00")).toBe("1200.00");
    expect(parseDocumentNumber("1.200")).toBe("1200");
    expect(parseDocumentNumber("1,5")).toBe("1.5");
    expect(parseDocumentNumber("4.000.000")).toBe("4000000");
    expect(parseDocumentNumber("1 200,00")).toBe("1200.00");
    expect(parseDocumentNumber("1.20.0")).toBeNull();
    expect(parseDocumentNumber("12.34.56")).toBeNull();
  });

  it("moneda: ISO o símbolo inequívoco; '$' solo no prueba USD ni COP", () => {
    const dollars = { status: "TEXT" as const, pages: ["Total $ 1.000"] };
    expect(verifyFields(dollars, [field({ field: "currency", kind: "CURRENCY", value: "USD" })])[0]!.status).toBe("NOT_FOUND");
    const euro = { status: "TEXT" as const, pages: ["Total 1.000,00 €"] };
    expect(verifyFields(euro, [field({ field: "currency", kind: "CURRENCY", value: "EUR" })])[0]!.status).toBe("TEXT_VERIFIED");
    // "USDT" no es USD.
    expect(verifyFields({ status: "TEXT", pages: ["Pago en USDT"] }, [field({ field: "currency", kind: "CURRENCY", value: "USD" })])[0]!.status).toBe("NOT_FOUND");
  });

  it("fechas: ISO, dd/mm/aaaa, español e inglés; dd/mm no se reinterpreta como mm/dd", () => {
    const pages = ["Emitida 2026-10-10 / 10.10.2026 / October 10, 2026 / 3 Nov 2026", "Vence 12/10/2026"];
    const r = (v: string) => verifyFields({ status: "TEXT", pages }, [field({ field: "d", kind: "DATE", value: v })])[0]!.status;
    expect(r("2026-10-10")).toBe("TEXT_VERIFIED");
    expect(r("2026-11-03")).toBe("TEXT_VERIFIED");
    expect(r("2026-10-12")).toBe("TEXT_VERIFIED"); // 12/10/2026 = 12 de octubre
    expect(r("2026-12-10")).toBe("NOT_FOUND"); // no se lee como mm/dd
  });

  it("sin capa de texto: UNVERIFIABLE; solo una confirmación humana del MISMO valor lo resuelve", () => {
    const fields = [field({ field: "totalAmount", kind: "TOTAL_AMOUNT", value: "1428.0000" })];
    expect(verifyFields({ status: "NO_TEXT", pages: [] }, fields)[0]!.status).toBe("UNVERIFIABLE");
    expect(verifyFields({ status: "MISSING", pages: [] }, fields)[0]!.status).toBe("UNVERIFIABLE");
    expect(verifyFields({ status: "NO_TEXT", pages: [] }, fields, new Map([["totalAmount", "1428.0000"]]))[0]!.status).toBe("HUMAN_CONFIRMED");
    expect(verifyFields({ status: "NO_TEXT", pages: [] }, fields, new Map([["totalAmount", "999.0000"]]))[0]!.status).toBe("UNVERIFIABLE");
    // Con texto, una confirmación NO convierte un NOT_FOUND en válido.
    expect(verifyFields(layer, [field({ field: "totalAmount", kind: "TOTAL_AMOUNT", value: "9999" })], new Map([["totalAmount", "9999"]]))[0]!.status).toBe("NOT_FOUND");
  });

  it("campos exigidos y códigos de regla", () => {
    const fields = evidenceFieldsFor(
      {
        supplierInvoiceNumber: "FAC-0001",
        issuerTaxReference: null,
        issueDate: "2026-10-10",
        servicePeriodStart: null,
        servicePeriodEnd: null,
        currency: "USD",
        subtotal: "1200.0000",
        taxes: "0.0000",
        discounts: null,
        totalAmount: "1200.0000",
        contractRefCited: "CT-1",
        lines: [{ lineNo: 1, itemRef: "DEV", quantity: "40.0000", unitPrice: "30.000000", subtotal: "1200.0000" }],
      },
      "CO98765432101122",
    );
    expect(fields.map((f) => f.field)).toEqual([
      "supplierInvoiceNumber",
      "totalAmount",
      "currency",
      "issueDate",
      "paymentAccount",
      "contractRefCited",
      "subtotal",
      "lines[1].subtotal",
      "lines[1].unitPrice",
      "lines[1].quantity",
      "lines[1].itemRef",
    ]);
    expect(fields.filter((f) => f.critical).map((f) => f.field)).toEqual(["supplierInvoiceNumber", "totalAmount", "currency", "issueDate", "paymentAccount"]);
    expect(evidenceRuleCode("totalAmount")).toBe("EVIDENCE_TOTAL_AMOUNT");
    expect(evidenceRuleCode("lines[2].unitPrice")).toBe("EVIDENCE_LINE_2_UNIT_PRICE");
  });
});
