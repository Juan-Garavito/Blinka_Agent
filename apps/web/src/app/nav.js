/** Arquitectura de información: 3 grupos de primer nivel (Reglas v2.1 §6, UX §2.1). */
export const NAV_GROUPS = [
  {
    id: "ops",
    label: "Operaciones",
    items: [
      { to: "/", label: "Centro de operaciones", end: true },
      { to: "/invoices", label: "Facturas" },
      { to: "/approvals", label: "Aprobaciones" },
      { to: "/business", label: "Negocio y ROI" },
    ],
  },
  {
    id: "mgmt",
    label: "Gestión",
    items: [
      { to: "/vendors", label: "Proveedores" },
      { to: "/contracts", label: "Contratos" },
      { to: "/policies", label: "Políticas" },
      { to: "/budgets", label: "Presupuestos" },
      { to: "/settings", label: "Configuración" },
    ],
  },
  {
    id: "audit",
    label: "Auditoría",
    items: [
      { to: "/audit", label: "Eventos", end: true },
      { to: "/audit/ai-usage", label: "Uso de IA" },
    ],
  },
];

export function groupForPath(pathname) {
  const match = (to, end) => (end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`));
  return NAV_GROUPS.find((g) => g.items.some((i) => match(i.to, i.end && i.to === "/"))) ?? NAV_GROUPS[0];
}
