import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { ButtonLink, PageHeader } from "../components/ui.jsx";

export function NotFound({ what = "La dirección no existe o el recurso no pertenece a tu empresa." }) {
  return (
    <>
      <PageHeader eyebrow="404" title="No encontramos esta página">
        {what}
      </PageHeader>
      <ButtonLink to="/" variant="secondary">Volver al centro de operaciones</ButtonLink>
    </>
  );
}

/** Límite de error de ruta: mensaje accionable, sin ocultar el problema. */
export function RouteError() {
  const err = useRouteError();
  const message = isRouteErrorResponse(err) ? `${err.status} ${err.statusText}` : err instanceof Error ? err.message : "Error inesperado";
  return (
    <div style={{ padding: "48px 24px", maxWidth: 720, margin: "0 auto", display: "grid", gap: 16 }}>
      <p className="eyebrow">Error de la interfaz</p>
      <h1>Algo falló al mostrar esta vista</h1>
      <p className="muted">{message}</p>
      <p>
        <Link to="/">Volver al inicio</Link> o recarga la página. Si persiste, revisa la consola del servidor.
      </p>
    </div>
  );
}

export function FullPageLoader() {
  return (
    <div role="status" aria-label="Comprobando sesión" style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--muted)" }}>
      Comprobando sesión…
    </div>
  );
}
