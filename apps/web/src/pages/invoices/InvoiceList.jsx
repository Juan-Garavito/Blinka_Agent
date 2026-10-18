import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  BUSINESS_STATUS,
  StatusBadge,
  TECH_STATUS,
} from "../../components/StatusBadge.jsx";
import { Money } from "../../components/Money.jsx";
import {
  Button,
  ButtonLink,
  EmptyState,
  ErrorPanel,
  PageHeader,
  Skeleton,
} from "../../components/ui.jsx";
import { IconPlus, IconSearch } from "../../components/icons.jsx";
import { useAutoRefresh, useResource } from "../../lib/hooks.js";
import { formatDate, formatRelative } from "../../lib/format.js";
import styles from "./InvoiceList.module.css";

const PAGE = 20;
const FILTER_KEYS = [
  "status",
  "vendorId",
  "currency",
  "q",
  "from",
  "to",
  "sort",
];
const SORTS = [
  ["created_desc", "Más recientes"],
  ["created_asc", "Más antiguas"],
  ["amount_desc", "Importe mayor (moneda original)"],
  ["amount_asc", "Importe menor (moneda original)"],
];
const CURRENCIES = ["USD", "EUR", "COP", "GBP"];

/** Lista paginada; TODOS los filtros viven en la URL (compartible, sobrevive a recargas). */
export default function InvoiceList() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const qs = new URLSearchParams();
  for (const k of FILTER_KEYS) if (params.get(k)) qs.set(k, params.get(k));
  qs.set("limit", String(PAGE));
  qs.set("offset", String((page - 1) * PAGE));
  const list = useResource(`/api/invoices?${qs}`);
  const vendors = useResource("/api/vendors");
  const [q, setQ] = useState(params.get("q") ?? "");
  const rows = list.data?.invoices ?? [];
  useAutoRefresh(
    list.reload,
    rows.some((r) => r.processing),
  );

  const update = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch))
      v ? next.set(k, v) : next.delete(k);
    next.delete("page");
    setParams(next);
  };
  const active = FILTER_KEYS.filter((k) => k !== "sort" && params.get(k));
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <>
      <PageHeader
        eyebrow="Operaciones"
        title="Facturas"
        actions={
          <ButtonLink to="/invoices/new" icon={IconPlus}>
            Nueva factura
          </ButtonLink>
        }
      >
        Expedientes de cuentas por pagar con su último resultado del motor de
        decisión.
      </PageHeader>

      <form
        className={styles.filters}
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: q.trim() });
        }}
      >
        <div className={styles.searchGroup}>
          <label className={styles.search}>
            <span className="visually-hidden">
              Buscar por número de factura o proveedor
            </span>
            <IconSearch size={16} />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Número de factura o proveedor"
              maxLength={80}
            />
          </label>
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            className={styles.searchBtn}
          >
            Buscar
          </Button>
        </div>
        <Select
          label="Estado"
          value={params.get("status") ?? ""}
          onChange={(v) => update({ status: v })}
        >
          <option value="">Todos los estados</option>
          {Object.entries(BUSINESS_STATUS).map(([k, s]) => (
            <option key={k} value={k}>
              {s.label}
            </option>
          ))}
          <option value="PROCESSING">
            {TECH_STATUS.PROCESSING.label} (técnico)
          </option>
          <option value="NOT_EVALUATED">
            {TECH_STATUS.NOT_EVALUATED.label} (técnico)
          </option>
        </Select>
        <Select
          label="Proveedor"
          value={params.get("vendorId") ?? ""}
          onChange={(v) => update({ vendorId: v })}
        >
          <option value="">Todos los proveedores</option>
          {(vendors.data?.vendors ?? []).map((v) => (
            <option key={v.id} value={v.id}>
              {v.legalName}
            </option>
          ))}
        </Select>
        <Select
          label="Moneda"
          value={params.get("currency") ?? ""}
          onChange={(v) => update({ currency: v })}
        >
          <option value="">Todas</option>
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
        <label className={styles.ctl}>
          <span>Registrada desde</span>
          <input
            type="date"
            value={params.get("from") ?? ""}
            onChange={(e) => update({ from: e.target.value })}
          />
        </label>
        <label className={styles.ctl}>
          <span>hasta</span>
          <input
            type="date"
            value={params.get("to") ?? ""}
            onChange={(e) => update({ to: e.target.value })}
          />
        </label>
        <Select
          label="Orden"
          value={params.get("sort") ?? "created_desc"}
          onChange={(v) => update({ sort: v === "created_desc" ? "" : v })}
        >
          {SORTS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </form>

      <div className={styles.summary} aria-live="polite">
        <span>
          {list.data
            ? `${total} ${total === 1 ? "factura" : "facturas"}`
            : "Cargando…"}
          {active.length > 0 &&
            ` · ${active.length} ${active.length === 1 ? "filtro activo" : "filtros activos"}`}
        </span>
        {active.length > 0 && (
          <button
            type="button"
            className={styles.clear}
            onClick={() => {
              setQ("");
              setParams(
                new URLSearchParams(
                  params.get("sort") ? { sort: params.get("sort") } : {},
                ),
              );
            }}
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {list.error ? (
        <ErrorPanel error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Skeleton lines={8} label="Cargando facturas" />
      ) : rows.length === 0 ? (
        active.length ? (
          <EmptyState title="Ninguna factura coincide con los filtros">
            Ajusta o limpia los filtros para ver más resultados.
          </EmptyState>
        ) : (
          <EmptyState
            title="Aún no hay facturas"
            action={
              <ButtonLink to="/invoices/new" icon={IconPlus}>
                Cargar factura
              </ButtonLink>
            }
          >
            Carga el documento de una factura y selecciona su proveedor para
            iniciar el análisis.
          </EmptyState>
        )
      ) : (
        <div className="ledger-wrap" aria-busy={list.loading || undefined}>
          <table className={`ledger stack ${list.loading ? styles.dim : ""}`}>
            <caption className="visually-hidden">
              Facturas, página {page} de {pages}
            </caption>
            <thead>
              <tr>
                <th>Factura</th>
                <th>Estado</th>
                <th className="num">Importe original</th>
                <th className="hide-sm">Emisión</th>
                <th className="hide-sm">Registrada</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inv) => (
                <tr
                  key={inv.id}
                  className="is-link"
                  onClick={(e) =>
                    e.target.closest("a") || navigate(`/invoices/${inv.id}`)
                  }
                >
                  <td className="primary-cell">
                    <Link to={`/invoices/${inv.id}`}>
                      {inv.supplierInvoiceNumber ?? "Sin número extraído"}
                    </Link>
                    <span className="sub">
                      {inv.vendorName}
                      {inv.vendorStatus !== "AUTHORIZED" && (
                        <em className={styles.vendorFlag}>
                          {" "}
                          · proveedor{" "}
                          {inv.vendorStatus === "BLOCKED"
                            ? "bloqueado"
                            : "pendiente"}
                        </em>
                      )}
                    </span>
                  </td>
                  <td>
                    <StatusBadge
                      status={inv.status}
                      processing={inv.processing}
                      size="sm"
                    />
                    {inv.duplicateOfInvoiceId && (
                      <span className={styles.dup}>posible duplicado</span>
                    )}
                  </td>
                  <td className="num">
                    <Money value={inv.totalAmount} currency={inv.currency} />
                  </td>
                  <td className="hide-sm">{formatDate(inv.issueDate)}</td>
                  <td className="hide-sm muted">
                    {formatRelative(inv.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className={styles.pager} aria-label="Paginación">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(params, setParams, page - 1)}
          >
            Anterior
          </Button>
          <span>
            Página {page} de {pages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= pages}
            onClick={() => setPage(params, setParams, page + 1)}
          >
            Siguiente
          </Button>
        </nav>
      )}
    </>
  );
}

function setPage(params, setParams, n) {
  const next = new URLSearchParams(params);
  if (n > 1) next.set("page", String(n));
  else next.delete("page");
  setParams(next);
}

function Select({ label, value, onChange, children }) {
  return (
    <label className={styles.ctl}>
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}
