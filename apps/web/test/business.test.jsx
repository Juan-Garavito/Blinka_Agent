import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import Business from "../src/pages/Business.jsx";

const BODY = {
  period: "2026-10",
  baseCurrency: "USD",
  assumptions: { reviewMinutes: 15, analystHourlyUsd: "12.00" },
  outcomes: { AUTORIZADA: 3, BLOQUEADA: 1 },
  note: "Separados.",
  metrics: [
    { key: "automationRate", label: "Resueltas sin intervención humana", value: "75.0", unit: "%", definition: "Autorizadas por el motor + bloqueadas.", denominator: "Facturas con decisión", source: "evaluation_runs", hypothetical: false },
    { key: "aiCost", label: "Coste de IA (estimado)", value: "0.096422", unit: "USD", definition: "Coste de lista de 9 llamadas.", source: "ai_usage_logs", hypothetical: false },
    { key: "roi", label: "ROI de la IA", value: "30.11", unit: "×", definition: "Ahorro neto ÷ coste de IA.", source: "Cálculo", hypothetical: true },
  ],
};

describe("Negocio y ROI", () => {
  afterEach(() => vi.restoreAllMocks());
  it("separa hechos, coste de IA e hipotético; formatea y explica cada cifra", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(BODY));
    render(<RouterProvider router={createMemoryRouter([{ path: "/business", element: <Business /> }], { initialEntries: ["/business?reviewMinutes=15"] })} />);
    const hechos = await screen.findByRole("region", { name: "Hechos medidos" });
    expect(within(hechos).getByText("75,0 %")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Coste de IA (estimado)" })).getByText("0,096422 USD")).toBeInTheDocument();
    const roi = screen.getByRole("region", { name: "Ahorro y ROI (hipotético)" });
    expect(within(roi).getByText("30,11×")).toBeInTheDocument();
    expect(within(roi).getByText("· hipotético")).toBeInTheDocument();
    expect(screen.getAllByText("Cómo se calcula")).toHaveLength(3);
    expect(screen.getByText("Denominador: Facturas con decisión")).toBeInTheDocument();
    expect(String(f.mock.calls[0][0])).toContain("/api/business-metrics?reviewMinutes=15");
  });
});
