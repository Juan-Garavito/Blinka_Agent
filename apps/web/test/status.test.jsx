import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BUSINESS_STATUS, StatusBadge } from "../src/components/StatusBadge.jsx";

describe("estados de negocio y técnicos", () => {
  it("los seis estados tienen texto y explicación propios (no solo color)", () => {
    expect(Object.keys(BUSINESS_STATUS)).toEqual(["AUTORIZADA", "EN_APROBACION", "EN_CORRECCION", "BLOQUEADA", "RECHAZADA", "ERROR"]);
    for (const [code, s] of Object.entries(BUSINESS_STATUS)) {
      const { unmount } = render(<StatusBadge status={code} withExplain />);
      expect(screen.getByText(s.label)).toBeInTheDocument();
      expect(screen.getByTitle(s.explain)).toBeInTheDocument();
      unmount();
    }
    expect(BUSINESS_STATUS.RECHAZADA.explain).toMatch(/distinto de un bloqueo/);
    expect(BUSINESS_STATUS.AUTORIZADA.explain).toMatch(/SIMULADAS/);
    expect(BUSINESS_STATUS.ERROR.explain).toMatch(/No implica decisión financiera/);
  });
  it("el procesamiento es un estado técnico, distinto de los de negocio", () => {
    render(<StatusBadge status="AUTORIZADA" processing />);
    expect(screen.getByText("Analizando")).toBeInTheDocument();
    expect(screen.queryByText("Autorizada")).toBeNull();
  });
});
