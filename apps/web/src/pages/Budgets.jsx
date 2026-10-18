import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Money } from "../components/Money.jsx";
import { Button, EmptyState, ErrorPanel, Field, Notice, PageHeader, Skeleton, useToast } from "../components/ui.jsx";
import { IconArrowLeft, IconArrowRight, IconFlask } from "../components/icons.jsx";
import { api } from "../lib/api.js";
import { useResource } from "../lib/hooks.js";
import { formatDateTime, formatDecimal, formatPeriod, ratioPermille, trimZeros } from "../lib/format.js";
import { useSession } from "../lib/session.jsx";
import m from "./manage.module.css";
import s from "./Budgets.module.css";

const MONEY = /^\d{1,16}(\.\d{1,4})?$/;

/** Período actual en la zona horaria de la empresa (la autorización usa el período LOCAL). */
export function currentPeriod(timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return `${parts.find((p) => p.type === "year").value}-${parts.find((p) => p.type === "month").value}`;
}
export function shiftPeriod(period, delta) {
  const [y, mo] = period.split("-").map(Number);
  const idx = y * 12 + (mo - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

export default function Budgets() {
  const { company } = useSession();
  const [params, setParams] = useSearchParams();
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get("period") ?? "") ? params.get("period") : currentPeriod(company?.timezone ?? "UTC");
  const budgets = useResource(`/api/budgets?period=${period}`);
  const reservations = useResource(`/api/budgets/reservations?period=${period}`);
  const categories = useResource("/api/categories");
  const [editing, setEditing] = useState(null);
  const base = company?.baseCurrency ?? "";
  const catName = (id) => categories.data?.categories.find((c) => c.id === id)?.name ?? "Categoría";
  const rows = [...(budgets.data?.budgets ?? [])].sort((a, b) => (a.scope === "GLOBAL" ? -1 : b.scope === "GLOBAL" ? 1 : 0));
  const missing = [{ scope: "GLOBAL", categoryId: null }, ...(categories.data?.categories ?? []).filter((c) => c.active).map((c) => ({ scope: "CATEGORY", categoryId: c.id }))].filter((x) => !rows.some((b) => b.scope === x.scope && b.categoryId === x.categoryId));
  const go = (p) => setParams({ period: p });

  return (
    <>
      <PageHeader eyebrow="Gestión" title="Presupuestos">
        Límite mensual por empresa y por categoría en moneda base ({base}). Cada factura autorizada reserva (de forma <strong>simulada</strong>) su importe en ambos; nunca se permite sobregiro.
      </PageHeader>
      <nav className={s.period} aria-label="Período">
        <Button variant="ghost" size="sm" icon={IconArrowLeft} onClick={() => go(shiftPeriod(period, -1))}>
          Anterior
        </Button>
        <strong aria-live="polite">{formatPeriod(period)}</strong>
        <Button variant="ghost" size="sm" onClick={() => go(shiftPeriod(period, 1))}>
          Siguiente <IconArrowRight size={16} />
        </Button>
        <label className={m.ctl}>
          <span className="visually-hidden">Ir al período</span>
          <input type="month" value={period} onChange={(e) => e.target.value && go(e.target.value)} />
        </label>
      </nav>

      {budgets.error ? (
        <ErrorPanel error={budgets.error} onRetry={budgets.reload} />
      ) : !budgets.data ? (
        <Skeleton lines={4} />
      ) : (
        <section className={s.budgetGrid} aria-label="Presupuestos del período">
          {rows.length === 0 && <EmptyState title="Sin presupuestos en este período">Sin presupuesto, el motor no puede autorizar facturas de este mes.</EmptyState>}
          {rows.map((b) => {
            const pm = ratioPermille(b.reservedBase, b.limitBase);
            return (
              <article key={b.id} className={s.budget}>
                <header>
                  <h2>{b.scope === "GLOBAL" ? "Global de la empresa" : catName(b.categoryId)}</h2>
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ scope: b.scope, categoryId: b.categoryId, limitBase: trimZeros(b.limitBase), reservedBase: b.reservedBase })}>
                    Ajustar límite
                  </Button>
                </header>
                <p className={s.available}>
                  {formatDecimal(b.availableBase)} <small>{base} disponibles</small>
                </p>
                <div className={s.bar} role="img" aria-label={`Reservado ${Math.round(pm / 10)} % del límite`}>
                  <span style={{ width: `${pm / 10}%` }} data-high={pm >= 800 || undefined} />
                </div>
                <dl className={s.figures}>
                  <div>
                    <dt>Límite</dt>
                    <dd>
                      <Money value={b.limitBase} currency={base} />
                    </dd>
                  </div>
                  <div>
                    <dt>Reservado (simulado)</dt>
                    <dd>
                      <Money value={b.reservedBase} currency={base} />
                    </dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </section>
      )}

      {editing && <BudgetForm period={period} base={base} value={editing} label={editing.scope === "GLOBAL" ? "Global" : catName(editing.categoryId)} onClose={() => setEditing(null)} onDone={budgets.reload} />}
      {categories.data && budgets.data && missing.length > 0 && !editing && (
        <div className={m.actions} style={{ margin: "16px 0" }}>
          <span className="muted">Sin presupuesto:</span>
          {missing.map((x) => (
            <Button key={x.categoryId ?? "g"} size="sm" variant="secondary" onClick={() => setEditing({ ...x, limitBase: "", reservedBase: "0" })}>
              Definir {x.scope === "GLOBAL" ? "global" : catName(x.categoryId)}
            </Button>
          ))}
        </div>
      )}

      <section aria-labelledby="res-h" style={{ marginTop: 32 }}>
        <h2 id="res-h" className={s.h2}>
          Reservas del período <span className="muted">· simuladas, sin movimiento de dinero</span>
        </h2>
        {reservations.error ? (
          <ErrorPanel error={reservations.error} onRetry={reservations.reload} />
        ) : !reservations.data ? (
          <Skeleton lines={4} />
        ) : reservations.data.reservations.length === 0 ? (
          <EmptyState title="Sin reservas en este período" />
        ) : (
          <div className="ledger-wrap">
            <table className="ledger stack">
              <thead>
                <tr>
                  <th>Factura</th>
                  <th className="num">Importe original</th>
                  <th className="num">Reservado ({base})</th>
                  <th className="hide-sm">Asignaciones</th>
                  <th className="hide-sm">Autorizada</th>
                </tr>
              </thead>
              <tbody>
                {reservations.data.reservations.map((r) => (
                  <tr key={r.id}>
                    <td className="primary-cell">
                      <Link to={`/invoices/${r.invoiceId}`}>{r.supplierInvoiceNumber ?? "Sin número"}</Link>
                      <span className="sub">{r.vendorName}</span>
                    </td>
                    <td className="num" data-label="Original">
                      <Money value={r.originalAmount} currency={r.originalCurrency} />
                    </td>
                    <td className="num">
                      <Money value={r.reservedAmountBase} currency={r.baseCurrency} strong />
                    </td>
                    <td className="hide-sm">
                      {r.allocations.map((a) => (
                        <span key={a.monthlyBudgetId} className={s.alloc}>
                          {a.scope === "GLOBAL" ? "Global" : catName(rows.find((b) => b.id === a.monthlyBudgetId)?.categoryId)}: {formatDecimal(a.amountBase)}
                        </span>
                      ))}
                    </td>
                    <td className="hide-sm muted">{formatDateTime(r.authorizedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={m.fine} style={{ marginTop: 8 }}>
          <IconFlask size={14} /> Las reservas son contables y simuladas: ninguna acción ejecuta pagos.
        </p>
      </section>
    </>
  );
}

function BudgetForm({ period, base, value, label, onClose, onDone }) {
  const toast = useToast();
  const [limit, setLimit] = useState(value.limitBase);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const err = !MONEY.test(limit) ? "Importe decimal con punto, hasta 4 decimales." : null;
  const submit = async (e) => {
    e.preventDefault();
    if (err || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/budgets", { method: "PUT", body: { period, scope: value.scope, ...(value.categoryId ? { categoryId: value.categoryId } : {}), limitBase: limit } });
      toast(`Presupuesto ${label} de ${formatPeriod(period)} actualizado.`);
      onDone();
      onClose();
    } catch (e2) {
      setError(e2);
      setBusy(false);
    }
  };
  return (
    <form className={`${m.panel} ${m.newPanel}`} onSubmit={submit} noValidate style={{ marginTop: 16 }}>
      <h2 className={m.panelTitle}>
        Límite {label} · {formatPeriod(period)}
      </h2>
      <div className={m.formGrid}>
        <Field label={`Límite (${base})`} required error={limit ? err : null} hint={`Reservado actualmente: ${formatDecimal(value.reservedBase)} ${base}. El límite no puede quedar por debajo de lo reservado.`}>
          {(p) => <input {...p} inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} autoFocus />}
        </Field>
      </div>
      {error && <ErrorPanel error={error} title="No se pudo guardar" />}
      <Notice tone="info">El cambio queda auditado y afecta solo a las próximas evaluaciones.</Notice>
      <div className={m.actions}>
        <Button type="submit" loading={busy}>
          Guardar límite
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
