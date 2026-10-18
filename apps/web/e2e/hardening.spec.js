import { expect, test } from "@playwright/test";
import { alfaInvoicePdf, captureEvidence, login, timesheetPdf, uniqueNumber } from "./support.js";

const SHOTS = "../../docs/implementation/evidence/frontend";

async function upload(page, number, buffer, mimeType = "application/pdf", hours = "10") {
  await page.goto("/invoices/new");
  await page.getByRole("radio", { name: /Alfa Software SAS/ }).check();
  await page.getByLabel("Documento de la factura", { exact: true }).setInputFiles({ name: `${number}.${mimeType === "image/png" ? "png" : "pdf"}`, mimeType, buffer });
  await page.getByLabel("Hoja de horas", { exact: true }).setInputFiles({ name: `horas-${number}.pdf`, mimeType: "application/pdf", buffer: timesheetPdf(number, hours) });
  await page.getByRole("button", { name: "Cargar y analizar" }).click();
  await expect(page.locator("#dec-h")).toHaveText(/Autorizada|En aprobación|En corrección|Bloqueada/, { timeout: 45000 });
}

test("aprobación simulada exige motivo y muestra reevaluación", async ({ page }) => {
  await login(page);
  const number = uniqueNumber("E2E-APR");
  await upload(page, number, alfaInvoicePdf({ number, hours: "200" }), "application/pdf", "200");
  await expect(page.locator("#dec-h")).toHaveText("En aprobación");
  await page.goto("/approvals");
  const card = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: number, exact: true }) });
  await expect(card).toBeVisible();
  const resolver = card.getByRole("button", { name: "Resolver", exact: true });
  if (await resolver.isVisible()) await resolver.click();
  await card.getByLabel(/^Motivo/).fill("x");
  await card.getByRole("button", { name: "Registrar resolución" }).click();
  await expect(card.getByText("Indica el motivo (mínimo 3 caracteres).")).toBeVisible();
  await card.getByRole("radio", { name: /^Aprobar/ }).check();
  await card.getByLabel(/^Motivo/).fill("Prueba E2E local: revisión de factura y contrato.");
  await card.getByRole("button", { name: "Registrar resolución" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Aprobar y reevaluar" }).click();
  await expect(card.getByText("Aprobación registrada y factura reevaluada")).toBeVisible();
  await captureEvidence(page, { path: `${SHOTS}/05-aprobacion-desktop.png`, fullPage: true });
});

test("imagen sin texto: confirmar campos y reanalizar", async ({ page, context }) => {
  await login(page);
  const number = uniqueNumber("E2E-SCAN");
  const fixture = alfaInvoicePdf({ number }).toString("latin1").match(/%BLINKA-FIXTURE:[^\s]+/)[0];
  const imagePage = await context.newPage();
  await imagePage.setContent(`<main style="padding:32px;background:white;color:black;font:20px sans-serif"><h1>Factura FICTICIA ${number}</h1><p>Fecha de emision: 2026-10-05</p><p>Periodo: 2026-10-01</p><p>DEV Desarrollo 10 HOUR x 30.00 = 300.00</p><p>Subtotal: 300.00 · Impuestos: 0</p><p>TOTAL A PAGAR: USD 300.00</p><p>Transferir a CO00DEMO1000000001</p></main>`);
  const png = await imagePage.locator("main").screenshot();
  await imagePage.close();
  await upload(page, number, Buffer.concat([png, Buffer.from(`\n${fixture}\n`)]), "image/png");
  await expect(page.locator("#dec-h")).toHaveText("En corrección");
  await page.getByRole("link", { name: /^Evidencia/ }).click();
  await expect(page.getByRole("heading", { name: "Confirmación humana de campos" })).toBeVisible();
  const image = page.getByRole("img", { name: /^Imagen del documento/ });
  await expect.poll(() => image.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: /^Confirmar .* y reanalizar/ })).toBeDisabled();
  await page.getByLabel("Motivo (mínimo 10 caracteres)").fill("Revisé el original ficticio; los valores coinciden.");
  await page.getByLabel("Revisé el documento original y los valores seleccionados coinciden.").check();
  await captureEvidence(page, { path: `${SHOTS}/06-confirmacion-desktop.png`, fullPage: true });
  await page.getByRole("button", { name: /^Confirmar .* y reanalizar/ }).click();
  await expect(page.locator("#dec-h")).toHaveText("Autorizada", { timeout: 45000 });
  await page.getByRole("link", { name: /^Evidencia/ }).click();
  await expect(page.getByRole("button", { name: /^Total/ })).toContainText("Confirmado por una persona");
});

test("páginas principales sin desbordamiento ni errores @mobile", async ({ page }, info) => {
  await login(page);
  // El 401 de la consulta inicial de sesión es esperado antes de autenticarse.
  // Se verifican consola y excepciones de las páginas autenticadas del recorrido.
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  for (const [slug, route, title] of [
    ["dashboard", "/", "Centro de operaciones"], ["facturas", "/invoices", "Facturas"],
    ["nueva-factura", "/invoices/new", "Nueva factura"], ["aprobaciones", "/approvals", "Aprobaciones"],
    ["proveedores", "/vendors", "Proveedores"], ["contratos", "/contracts", "Contratos"],
    ["politicas", "/policies", "Políticas"], ["presupuestos", "/budgets", "Presupuestos"],
    ["auditoria", "/audit", "Eventos de auditoría"], ["configuracion", "/settings", "Configuración"],
  ]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(page.getByRole("status", { name: /^Cargando/ })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await captureEvidence(page, { path: `${SHOTS}/${slug}-${info.project.name}.png`, fullPage: true });
  }
  expect(errors).toEqual([]);
  if (info.project.name === "mobile") {
    await page.getByRole("button", { name: "Abrir menú" }).click();
    await page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", { name: "Facturas", exact: true }).click();
    await expect(page).toHaveURL(/\/invoices$/);
    await expect(page.getByRole("button", { name: "Abrir menú" })).toBeVisible();
  }
});
