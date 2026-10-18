import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { VENDOR_STATUS, VendorStatusBadge } from "../../components/VendorStatus.jsx";
import { Button, EmptyState, ErrorPanel, Field, PageHeader, Skeleton, useToast } from "../../components/ui.jsx";
import { IconPlus, IconSearch } from "../../components/icons.jsx";
import { api } from "../../lib/api.js";
import { useResource } from "../../lib/hooks.js";
import { formatRelative } from "../../lib/format.js";
import m from "../manage.module.css";

/** Solo rutas internas como retorno tras registrar (sin redirecciones abiertas). */
const safeReturn = (p) => (p && p.startsWith("/") && !p.startsWith("//") ? p : null);

export default function VendorList() {
  const [params, setParams] = useSearchParams();
  const vendors = useResource("/api/vendors");
  const contracts = useResource("/api/contracts");
  const [q, setQ] = useState("");
  const status = params.get("status") ?? "";
  const creating = params.get("new") === "1";
  const returnTo = safeReturn(params.get("returnTo"));

  const rows = (vendors.data?.vendors ?? []).filter((v) => (!status || v.status === status) && (!q.trim() || `${v.legalName} ${v.taxReference ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())));
  const nContracts = (id) => (contracts.data?.contracts ?? []).filter((c) => c.vendorId === id && c.status === "ACTIVE").length;

  return (
    <>
      <PageHeader
        eyebrow="Gestión"
        title="Proveedores"
        actions={
          !creating && (
            <Button icon={IconPlus} onClick={() => setParams({ new: "1" })}>
              Registrar proveedor
            </Button>
          )
        }
      >
        Maestro de proveedores. Solo un proveedor <strong>habilitado</strong> con cuenta habilitada puede quedar autorizado; los cambios de estado exigen motivo y quedan auditados.
      </PageHeader>

      {creating && <NewVendor returnTo={returnTo} onCancel={() => setParams({})} onCreated={vendors.reload} />}

      <div className={m.toolbar}>
        <label className={m.search}>
          <IconSearch size={16} />
          <span className="visually-hidden">Buscar proveedor</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Razón social o NIT" />
        </label>
        <label className={m.ctl}>
          <span>Estado</span>
          <select value={status} onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})}>
            <option value="">Todos</option>
            {Object.entries(VENDOR_STATUS).map(([k, s]) => (
              <option key={k} value={k}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {vendors.error ? (
        <ErrorPanel error={vendors.error} onRetry={vendors.reload} />
      ) : !vendors.data ? (
        <Skeleton lines={6} />
      ) : rows.length === 0 ? (
        <EmptyState title="Sin proveedores que mostrar">{q || status ? "Ajusta la búsqueda o el filtro." : "Registra el primer proveedor."}</EmptyState>
      ) : (
        <div className="ledger-wrap">
          <table className="ledger stack">
            <thead>
              <tr>
                <th>Proveedor</th>
                <th>Estado</th>
                <th className="num">Contratos activos</th>
                <th className="hide-sm">Actualizado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td className="primary-cell">
                    <Link to={`/vendors/${v.id}`}>{v.legalName}</Link>
                    <span className="sub">NIT {v.taxReference ?? "—"}</span>
                  </td>
                  <td>
                    <VendorStatusBadge status={v.status} />
                  </td>
                  <td className="num" data-label="Contratos">
                    {contracts.data ? nContracts(v.id) : "…"}
                  </td>
                  <td className="hide-sm muted">{formatRelative(v.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function NewVendor({ returnTo, onCancel, onCreated }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [legalName, setLegalName] = useState("");
  const [taxReference, setTaxReference] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const nameErr = legalName.trim() ? null : "La razón social es obligatoria.";
  const taxErr = taxReference && !/^[A-Za-z0-9.\- ]{3,60}$/.test(taxReference) ? "Usa solo letras, números, puntos o guiones (3–40 caracteres alfanuméricos)." : null;

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (nameErr || taxErr || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { vendor } = await api("/api/vendors", { method: "POST", body: { legalName: legalName.trim(), ...(taxReference.trim() ? { taxReference: taxReference.trim() } : {}) } });
      toast(`Proveedor «${vendor.legalName}» registrado como pendiente de habilitación.`);
      onCreated();
      if (returnTo) navigate(`${returnTo}${returnTo.includes("?") ? "&" : "?"}vendorId=${vendor.id}`);
      else navigate(`/vendors/${vendor.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <form className={`${m.panel} ${m.newPanel}`} onSubmit={submit} noValidate>
      <div className={m.panelHead}>
        <h2 className={m.panelTitle}>Registrar proveedor</h2>
        {returnTo && <span className="muted">Al guardar volverás a la carga de factura con el proveedor seleccionado.</span>}
      </div>
      <div className={m.formGrid}>
        <Field label="Razón social" required error={touched ? nameErr : null}>
          {(p) => <input {...p} value={legalName} onChange={(e) => setLegalName(e.target.value)} maxLength={200} autoFocus />}
        </Field>
        <Field label="NIT / identificación fiscal" hint="Opcional. Se normaliza (sin puntos ni guiones)." error={touched ? taxErr : null}>
          {(p) => <input {...p} value={taxReference} onChange={(e) => setTaxReference(e.target.value)} maxLength={60} />}
        </Field>
      </div>
      <p className="muted">El proveedor nace <strong>pendiente de habilitación</strong>: sus facturas irán a aprobación hasta que se habilite junto con una cuenta bancaria.</p>
      {error && <ErrorPanel error={error} title="No se pudo registrar" />}
      <div className={m.actions}>
        <Button type="submit" loading={busy}>
          Registrar
        </Button>
        <Button type="button" variant="ghost" onClick={returnTo ? () => navigate(returnTo) : onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
