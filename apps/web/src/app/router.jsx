import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate, Outlet, ScrollRestoration, useLocation } from "react-router";
import { Skeleton } from "../components/ui.jsx";
import { useSession } from "../lib/session.jsx";
import Login from "../pages/Login.jsx";
import { FullPageLoader, NotFound, RouteError } from "../pages/System.jsx";
import { AppShell } from "./AppShell.jsx";

const page = (loader) => {
  const C = lazy(loader);
  return (
    <Suspense fallback={<Skeleton lines={6} label="Cargando vista" />}>
      <C />
    </Suspense>
  );
};

/** No se muestra contenido protegido antes de validar la sesión (UX §2.4.6). */
function RequireAuth() {
  const { status } = useSession();
  const location = useLocation();
  if (status === "loading") return <FullPageLoader />;
  if (status !== "authenticated") return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <Outlet />;
}

function Root() {
  return (
    <>
      <ScrollRestoration />
      <Outlet />
    </>
  );
}

export const routes = [
  {
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      { path: "/login", element: <Login /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              { index: true, element: page(() => import("../pages/Dashboard.jsx")) },
              { path: "invoices", element: page(() => import("../pages/invoices/InvoiceList.jsx")) },
              { path: "invoices/new", element: page(() => import("../pages/invoices/InvoiceNew.jsx")) },
              { path: "invoices/:id/*", element: page(() => import("../pages/invoices/InvoiceDetail.jsx")) },
              { path: "approvals", element: page(() => import("../pages/Approvals.jsx")) },
              { path: "vendors", element: page(() => import("../pages/vendors/VendorList.jsx")) },
              { path: "vendors/:id", element: page(() => import("../pages/vendors/VendorDetail.jsx")) },
              { path: "contracts", element: page(() => import("../pages/contracts/ContractList.jsx")) },
              { path: "contracts/new", element: page(() => import("../pages/contracts/ContractNew.jsx")) },
              { path: "contracts/:id", element: page(() => import("../pages/contracts/ContractDetail.jsx")) },
              { path: "policies", element: page(() => import("../pages/Policies.jsx")) },
              { path: "policies/:id", element: page(() => import("../pages/Policies.jsx")) },
              { path: "budgets", element: page(() => import("../pages/Budgets.jsx")) },
              { path: "audit/*", element: page(() => import("../pages/Audit.jsx")) },
              { path: "settings", element: page(() => import("../pages/Settings.jsx")) },
              { path: "style-guide", element: page(() => import("../pages/StyleGuide.jsx")) },
              { path: "*", element: <NotFound /> },
            ],
          },
        ],
      },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
