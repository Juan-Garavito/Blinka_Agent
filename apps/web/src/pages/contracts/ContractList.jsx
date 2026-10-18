import { Link, useSearchParams } from "react-router";
import { BILLING_TYPE } from "../../components/VendorStatus.jsx";
import { ButtonLink, EmptyState, ErrorPanel, PageHeader, Skeleton } from "../../components/ui.jsx";
import { IconPlus } from "../../components/icons.jsx";
import { useResource } from "../../lib/hooks.js";
import { formatDate } from "../../lib/format.js";
import m from "../manage.module.css";

export default function ContractList() {
  const [params, setParams] = useSearchParams();
  const contracts = useResource("/api/contracts");
  const vendors = useResource("/api/vendors");
  const categories = useResource("/api/categories");
  // La lista de contratos no trae nombres: se cruzan en el cliente con /vendors y /categories.
  const vName = Object.fromEntries((vendors.data?.vendors ?? []).map((v) => [v.id, v.legalName]));
  const cName = Object.fromEntries((categories.data?.categories ?? []).map((c) => [c.id, c.name]));
  const type = params.get("billingType") ?? "";
  const vendorId = params.get("vendorId") ?? "";
  const rows = (contracts.data?.contracts ?? []).filter((c) => (!type || c.billingType === type) && (!vendorId || c.vendorId === vendorId));
  const set = (k, v) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n);
  };

  return (
    <>
      <PageHeader eyebrow="Gestión" title="Contratos" actions={<ButtonLink to="/contracts/new" icon={IconPlus}>Nuevo contrato</ButtonLink>}>
        Condiciones confirmadas por una persona contra las que el motor valida cada factura: modalidad, tarifas, hitos u órdenes, moneda y vigencia.
      </PageHeader>
      <div className={m.toolbar}>
        <label className={m.ctl}>
          <span>Modalidad</span>
          <select value={type} onChange={(e) => set("billingType", e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(BILLING_TYPE).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className={m.ctl}>
          <span>Proveedor</span>
          <select value={vendorId} onChange={(e) => set("vendorId", e.target.value)}>
            <option value="">Todos</option>
            {(vendors.data?.vendors ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.legalName}
              </option>
            ))}
          </select>
        </label>
      </div>
      {contracts.error ? (
        <ErrorPanel error={contracts.error} onRetry={contracts.reload} />
      ) : !contracts.data ? (
        <Skeleton lines={6} />
      ) : rows.length === 0 ? (
        <EmptyState title="Sin contratos" action={<ButtonLink to="/contracts/new" icon={IconPlus}>Registrar contrato</ButtonLink>} />
      ) : (
        <div className="ledger-wrap">
          <table className="ledger stack">
            <thead>
              <tr>
                <th>Contrato</th>
                <th>Modalidad</th>
                <th className="hide-sm">Categoría</th>
                <th>Estado</th>
                <th className="hide-sm">Registrado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="primary-cell">
                    <Link to={`/contracts/${c.id}`}>{c.contractRef}</Link>
                    <span className="sub">{vName[c.vendorId] ?? "…"}</span>
                  </td>
                  <td>{BILLING_TYPE[c.billingType] ?? c.billingType}</td>
                  <td className="hide-sm">{cName[c.categoryId] ?? "—"}</td>
                  <td>{c.status === "ACTIVE" ? "Vigente" : "Terminado"}</td>
                  <td className="hide-sm muted">{formatDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
