import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../src/components/ui.jsx";
import InvoiceNew from "../src/pages/invoices/InvoiceNew.jsx";

const VENDORS = {
  vendors: [
    { id: "v1", legalName: "Alfa (FICTICIO)", taxReference: "900", status: "AUTHORIZED" },
    { id: "v2", legalName: "Gamma (FICTICIO)", taxReference: "901", status: "BLOCKED" },
  ],
};
const CONTRACTS = { contracts: [{ id: "c1", vendorId: "v1", contractRef: "CT-1", billingType: "HOURLY", status: "ACTIVE" }] };

function setup() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => new Response(JSON.stringify(String(url).includes("/contracts") ? CONTRACTS : VENDORS), { status: 200, headers: { "content-type": "application/json" } }));
  const router = createMemoryRouter([{ path: "/invoices/new", element: <InvoiceNew /> }], { initialEntries: ["/invoices/new"] });
  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  );
}

describe("Nueva factura", () => {
  afterEach(() => vi.restoreAllMocks());

  it("el proveedor es obligatorio y no se envía nada sin él", async () => {
    setup();
    await screen.findByRole("radio", { name: /Alfa/ });
    await userEvent.click(screen.getByRole("button", { name: "Cargar y analizar" }));
    expect(screen.getByText("Selecciona el proveedor que emitió la factura.")).toBeInTheDocument();
    expect(screen.getAllByText("Selecciona el documento de la factura.").length).toBeGreaterThan(0);
    // Solo las dos lecturas iniciales: ningún POST.
    expect(globalThis.fetch.mock.calls.every(([, init]) => (init?.method ?? "GET") === "GET")).toBe(true);
  });

  it("muestra el estado del proveedor y su consecuencia antes de cargar", async () => {
    setup();
    await userEvent.click(await screen.findByRole("radio", { name: /Gamma/ }));
    const summary = screen.getByRole("complementary", { name: "Resumen de la carga" });
    expect(within(summary).getByText("Proveedor bloqueado")).toBeInTheDocument();
    expect(within(summary).getByText(/una aprobación no lo anula/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Alfa/ }));
    expect(within(summary).getByText("CT-1 · Por horas")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Soporte de horas/ })).toBeInTheDocument();
  });

  it("rechaza localmente un formato no admitido", async () => {
    setup();
    await screen.findByRole("radio", { name: /Alfa/ });
    const input = screen.getByLabelText("Documento de la factura", { selector: "input" });
    await userEvent.upload(input, new File(["x"], "a.gif", { type: "image/gif" }), { applyAccept: false });
    expect(screen.getByText("Formato no admitido. Usa PDF, PNG o JPEG.")).toBeInTheDocument();
  });
});
