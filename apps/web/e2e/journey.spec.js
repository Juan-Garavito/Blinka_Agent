import { expect, test } from "@playwright/test";
import { alfaInvoicePdf, captureEvidence, login, timesheetPdf, uniqueNumber } from "./support.js";

const SHOTS = "../../docs/implementation/evidence/frontend";

test.describe("Recorrido prioritario: Dashboard → Nueva factura → proveedor → carga → análisis → decisión y evidencias", () => {
  test("factura por horas conforme queda AUTORIZADA con evidencia verificada en el texto @mobile", async ({ page }, info) => {
    await login(page);
    await expect(page.getByRole("heading", { level: 1, name: "Centro de operaciones" })).toBeVisible();
    if (info.project.name === "mobile") await page.locator("details").getByText(/^Demo ·/).click();
    await expect(page.getByText("IA simulada (FAKE (MOCK))").filter({ visible: true })).toBeVisible();
    if (info.project.name === "mobile") await page.locator("details").getByText(/^Demo ·/).click();
    // El Dashboard NO contiene el formulario de carga: solo el acceso.
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await page.getByRole("link", { name: "Nueva factura" }).first().click();

    await expect(page).toHaveURL(/\/invoices\/new$/);
    await expect(page.getByRole("heading", { level: 1, name: "Nueva factura" })).toBeVisible();

    // Proveedor obligatorio: enviar sin proveedor ni documento muestra los errores.
    await page.getByRole("button", { name: "Cargar y analizar" }).click();
    await expect(page.getByText("Selecciona el proveedor que emitió la factura.")).toBeVisible();

    await page.getByRole("searchbox", { name: "Buscar proveedor" }).fill("alfa");
    await page.getByRole("radio", { name: /Alfa Software SAS/ }).check();
    await expect(page.getByText("CT-ALFA-2026 · Por horas")).toBeVisible();

    const number = uniqueNumber("E2E-OK");
    await page.getByLabel("Documento de la factura", { exact: true }).setInputFiles({ name: `${number}.pdf`, mimeType: "application/pdf", buffer: alfaInvoicePdf({ number }) });
    await expect(page.getByText(`${number}.pdf`).first()).toBeVisible();
    // Contrato por horas: el formulario ofrece adjuntar la hoja de horas (soporte exigido por el motor).
    await page.getByLabel("Hoja de horas", { exact: true }).setInputFiles({ name: `horas-${number}.pdf`, mimeType: "application/pdf", buffer: timesheetPdf(number) });
    await captureEvidence(page, { path: `${SHOTS}/02-nueva-factura-${info.project.name}.png`, fullPage: true });
    await page.getByRole("button", { name: "Cargar y analizar" }).click();

    // Detalle con progreso REAL (polling) hasta la decisión del motor.
    await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}\?run=/);
    await expect(page.locator("#dec-h")).toHaveText("Autorizada", { timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText(number);
    await expect(page.getByText("Reserva presupuestaria (simulada)")).toBeVisible();
    await captureEvidence(page, { path: `${SHOTS}/03-decision-autorizada-${info.project.name}.png`, fullPage: true });

    // Evidencia: cada valor resaltado en su posición real del texto.
    await page.getByRole("link", { name: /^Evidencia/ }).click();
    await expect(page).toHaveURL(/\/evidence$/);
    const total = page.getByRole("button", { name: /^Total/ });
    await expect(total).toContainText("Verificado en el texto");
    await total.click();
    await expect(page).toHaveURL(/field=totalAmount/);
    await expect(page.locator('mark[data-fields~="totalAmount"]')).toHaveText("300.00");
    await captureEvidence(page, { path: `${SHOTS}/04-evidencia-${info.project.name}.png`, fullPage: info.project.name === "mobile" });

    // Investigación y pestañas direccionables (recarga conserva la vista).
    await page.getByRole("link", { name: /^Investigación/ }).click();
    await expect(page.getByText("Etapas del agente · corrida 1")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Etapas del agente · corrida 1")).toBeVisible();
  });

  test("discrepancia con el documento → EN CORRECCIÓN, sin opción de aprobar @mobile", async ({ page }) => {
    await login(page);
    await page.goto("/invoices/new");
    await page.getByRole("radio", { name: /Alfa Software SAS/ }).check();
    const number = uniqueNumber("E2E-DIF");
    await page.getByLabel("Documento de la factura", { exact: true }).setInputFiles({ name: `${number}.pdf`, mimeType: "application/pdf", buffer: alfaInvoicePdf({ number, tamperTotal: true }) });
    await page.getByRole("button", { name: "Cargar y analizar" }).click();
    await expect(page.locator("#dec-h")).toHaveText("En corrección", { timeout: 45_000 });
    await expect(page.getByText("Motivo principal · Evidencia · Total")).toBeVisible();
    await expect(page.getByRole("button", { name: /aprobar/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Corregir versión" })).toBeVisible();
    await page.getByRole("link", { name: "Ver evidencia del campo" }).click();
    await expect(page.getByRole("button", { name: /^Total/ })).toContainText("No aparece en el documento");
  });
});
