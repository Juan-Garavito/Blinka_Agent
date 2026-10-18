import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Credenciales del evaluador LOCAL: variables E2E_* o, en su defecto, apps/backend/.env (nunca se imprimen). */
export function credentials() {
  if (process.env.E2E_EMAIL && process.env.E2E_PASSWORD) return { email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD };
  const envPath = fileURLToPath(new URL("../../backend/.env", import.meta.url));
  const env = Object.fromEntries(
    readFileSync(envPath, "utf8")
      .split("\n")
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
  );
  return { email: env.SEED_EVALUATOR_EMAIL, password: env.SEED_EVALUATOR_PASSWORD };
}

// Una sesión por worker/proyecto; conserva cookies solo en memoria para evitar
// agotar el límite real por IP al ejecutar muchos recorridos autenticados.
let sessionCookies;
export async function captureEvidence(page, options) {
  if (!process.env.CI) await page.screenshot(options);
}

export async function login(page) {
  if (process.env.CI) await page.context().route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) ? route.continue() : route.abort();
  });
  if (sessionCookies) {
    await page.context().addCookies(sessionCookies);
    await page.goto("/");
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    return;
  }
  const { email, password } = credentials();
  await page.goto("/login");
  await page.getByLabel(/^Correo/).fill(email);
  await page.getByLabel(/^Contraseña/).fill(password);
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/auth/login" && r.request().method() === "POST");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  const result = await response;
  if (!result.ok()) throw new Error(`Login local: HTTP ${result.status()}; Retry-After=${result.headers()["retry-after"] ?? "no indicado"}`);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  sessionCookies = await page.context().cookies();
}

/** PDF mínimo VÁLIDO con capa de texto (mismo formato que el seed de demo del backend). */
function buildTextPdf(lines, comment) {
  const esc = (t) => t.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const content = ["BT", "/F1 11 Tf", "14 TL", "50 790 Td", ...lines.map((l) => `(${esc(l)}) Tj T*`), "ET"].join("\n");
  const objects = [
    null,
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [5 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>",
  ];
  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  if (comment) out += `% ${comment}\n`;
  const offsets = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(out, "latin1");
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/**
 * Factura FICTICIA por horas para el proveedor demo "Alfa Software" (tarifa 30 USD, cuenta CO00DEMO1000000001).
 * Incluye el marcador del proveedor de IA FAKE (MOCK) del backend: la "extracción" devuelve estos datos,
 * y el verificador los coteja con el TEXTO real del PDF (si `tamperTotal`, el texto muestra otro total).
 */
export function alfaInvoicePdf({ number, hours = "10", tamperTotal = false }) {
  const sub = (Number(hours) * 30).toFixed(2);
  const fmt = (v) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2 });
  const data = {
    documentKind: "INVOICE",
    billingType: "HOURLY",
    supplierInvoiceNumber: number,
    issueDate: "2026-10-05",
    servicePeriodStart: "2026-10-01",
    currency: "USD",
    subtotal: sub,
    taxes: "0",
    totalAmount: sub,
    paymentDestinationRaw: "Transferir a CO00DEMO1000000001",
    lines: [{ concept: "Desarrollo", itemRef: "DEV", quantity: hours, unit: "HOUR", unitPrice: "30", subtotal: sub }],
    evidence: [{ field: "totalAmount", page: 1, excerpt: "TOTAL A PAGAR" }],
    warnings: [],
  };
  const marker = `%BLINKA-FIXTURE:${Buffer.from(JSON.stringify(data)).toString("base64")}`;
  const lines = [
    "Proveedor FICTICIO de pruebas E2E - DOCUMENTO DE PRUEBA",
    `Factura No. ${number}`,
    "Fecha de emision: 2026-10-05",
    "Periodo de servicio: 2026-10-01 a -",
    `DEV Desarrollo ${hours} HOUR x 30.00 = ${fmt(sub)}`,
    `Subtotal: ${fmt(sub)}`,
    `TOTAL A PAGAR: USD ${tamperTotal ? fmt(Number(sub) + 1000) : fmt(sub)}`,
    "Pago a: Transferir a CO00DEMO1000000001",
  ];
  return buildTextPdf(lines, marker);
}

export const uniqueNumber = (prefix) => `${prefix}-${Date.now().toString(36).toUpperCase()}`;

/** Hoja de horas FICTICIA (documento de soporte con texto). */
export const timesheetPdf = (number, hours = "10") => buildTextPdf(["DOCUMENTO FICTICIO DE PRUEBAS E2E", `Hoja de horas - factura ${number}`, `DEV Desarrollo ${hours} HOUR`]);
