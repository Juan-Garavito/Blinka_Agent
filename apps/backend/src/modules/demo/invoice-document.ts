import { D } from "../../shared/money.js";
import { buildTextPdf } from "./simple-pdf.js";

export interface InvoiceDocData {
  supplierInvoiceNumber?: string | null;
  issuerTaxReference?: string | null;
  issueDate?: string | null;
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
  currency?: string | null;
  subtotal?: string | null;
  taxes?: string | null;
  totalAmount?: string | null;
  contractRefCited?: string | null;
  paymentDestinationRaw?: string | null;
  lines?: Array<{ concept: string; itemRef?: string | null; quantity?: string | null; unit?: string | null; unitPrice?: string | null; subtotal: string }>;
}

/** "1200.5" → "1,200.50" (formato con separador de miles; conserva decimales significativos). */
function fmt(v: string): string {
  const d = new D(v);
  const decimals = Math.max(2, (v.split(".")[1] ?? "").replace(/0+$/, "").length);
  const [int, frac] = d.toFixed(decimals).split(".");
  return `${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}

/**
 * Factura FICTICIA en PDF con capa de texto real (pruebas y demo). El texto
 * contiene exactamente los datos indicados, de modo que la verificación
 * documental es significativa; `marker` y `note` permiten incluir el marcador
 * del proveedor FAKE (MOCK) o texto hostil de prueba.
 */
export function renderInvoiceDocument(d: InvoiceDocData, opts: { marker?: string; note?: string; issuer?: string } = {}): Buffer {
  const lines: string[] = [`${opts.issuer ?? "Proveedor ficticio"} - DOCUMENTO DE PRUEBA`];
  if (d.issuerTaxReference) lines.push(`NIT emisor: ${d.issuerTaxReference}`);
  if (d.supplierInvoiceNumber) lines.push(`Factura No. ${d.supplierInvoiceNumber}`);
  if (d.issueDate) lines.push(`Fecha de emision: ${d.issueDate}`);
  if (d.servicePeriodStart || d.servicePeriodEnd) lines.push(`Periodo de servicio: ${d.servicePeriodStart ?? "-"} a ${d.servicePeriodEnd ?? "-"}`);
  if (d.contractRefCited) lines.push(`Contrato de referencia: ${d.contractRefCited}`);
  for (const l of d.lines ?? []) {
    const qty = l.quantity ? ` ${l.quantity}${l.unit ? ` ${l.unit}` : ""}` : "";
    const price = l.unitPrice ? ` x ${fmt(l.unitPrice)}` : "";
    lines.push(`${l.itemRef ? `${l.itemRef} ` : ""}${l.concept}${qty}${price} = ${fmt(l.subtotal)}`);
  }
  if (d.subtotal) lines.push(`Subtotal: ${fmt(d.subtotal)}`);
  if (d.taxes && !new D(d.taxes).isZero()) lines.push(`Impuestos: ${fmt(d.taxes)}`);
  if (d.totalAmount) lines.push(`TOTAL A PAGAR: ${d.currency ?? ""} ${fmt(d.totalAmount)}`.replace("  ", " "));
  else if (d.currency) lines.push(`Moneda: ${d.currency}`);
  if (d.paymentDestinationRaw) lines.push(`Pago a: ${d.paymentDestinationRaw}`);
  if (opts.note) lines.push(opts.note);
  return buildTextPdf([lines], opts.marker);
}
