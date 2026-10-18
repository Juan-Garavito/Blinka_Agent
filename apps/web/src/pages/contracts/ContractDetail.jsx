import { useState } from "react";
import { Link, useParams } from "react-router";
import { BILLING_TYPE } from "../../components/VendorStatus.jsx";
import { Money } from "../../components/Money.jsx";
import { Button, ConfirmDialog, ErrorPanel, Field, KeyValue, PageHeader, Skeleton, useToast } from "../../components/ui.jsx";
import { IconPlus } from "../../components/icons.jsx";
import { api } from "../../lib/api.js";
import { useResource } from "../../lib/hooks.js";
import { formatDate, formatDateTime, formatDecimal } from "../../lib/format.js";
import { NotFound } from "../System.jsx";
import { emptyVersion, FREQUENCIES, toPayload, validateVersion, VersionEditor } from "./VersionEditor.jsx";
import m from "../manage.module.css";
import s from "./contracts.module.css";

const V_STATUS = { CONFIRMED: "Confirmada", DRAFT: "Borrador", REJECTED: "Rechazada" };

export default function ContractDetail() {
  const { id } = useParams();
  const data = useResource(`/api/contracts/${id}`);
  const vendors = useResource("/api/vendors");
  const categories = useResource("/api/categories");
  const [adding, setAdding] = useState(false);
  const [reject, setReject] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const toast = useToast();

  if (data.error?.status === 404 || data.error?.code === "VALIDATION_ERROR") return <NotFound what="El contrato no existe o no pertenece a tu empresa." />;
  if (data.error) return <ErrorPanel error={data.error} onRetry={data.reload} />;
  if (!data.data) return <Skeleton lines={8} />;
  const { contract: c, versions } = data.data;
  const vendor = vendors.data?.vendors.find((v) => v.id === c.vendorId);
  const category = categories.data?.categories.find((x) => x.id === c.categoryId);

  const confirmVersion = async (v) => {
    setBusy(v.id);
    setError(null);
    try {
      await api(`/api/contracts/${id}/versions/${v.id}/confirm`, { method: "POST", body: {} });
      toast(`Versión ${v.versionNo} confirmada.`);
      data.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        breadcrumbs={[{ to: "/contracts", label: "Contratos" }, { label: c.contractRef }]}
        eyebrow={`${BILLING_TYPE[c.billingType]} · ${c.status === "ACTIVE" ? "vigente" : "terminado"}`}
        title={c.contractRef}
        actions={
          !adding && (
            <Button variant="secondary" icon={IconPlus} onClick={() => setAdding(true)}>
              Nueva versión
            </Button>
          )
        }
      />
      <section className={m.panel} style={{ marginBottom: 24 }}>
        <KeyValue
          columns={3}
          items={[
            ["Proveedor", vendor ? <Link to={`/vendors/${vendor.id}`}>{vendor.legalName}</Link> : "…"],
            ["Categoría de gasto", category?.name ?? "…"],
            ["Registrado", formatDateTime(c.createdAt)],
          ]}
        />
      </section>
      {adding && <NewVersion contract={c} onDone={() => { setAdding(false); data.reload(); }} onCancel={() => setAdding(false)} />}
      {error && <ErrorPanel error={error} title="No se pudo actualizar la versión" />}
      <div className={m.stack}>
        {[...versions].reverse().map((v) => (
          <article key={v.id} className={s.version}>
            <header className={s.versionHead}>
              <h2 className={m.panelTitle}>
                Versión {v.versionNo} <span className={s.vStatus} data-s={v.status}>{V_STATUS[v.status]}</span>
              </h2>
              {v.status === "DRAFT" && (
                <div className={m.actions}>
                  <Button size="sm" loading={busy === v.id} onClick={() => confirmVersion(v)}>
                    Confirmar condiciones
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setReject(v)}>
                    Rechazar
                  </Button>
                </div>
              )}
            </header>
            <div className={s.versionBody}>
              <KeyValue
                columns={4}
                items={[
                  ["Moneda", v.currency],
                  ["Vigencia", `${formatDate(v.effectiveFrom)} – ${v.effectiveTo ? formatDate(v.effectiveTo) : "indefinida"}`],
                  ["Frecuencia", v.billingFrequency ? FREQUENCIES[v.billingFrequency] : null],
                  v.fixedPeriodAmount ? ["Importe por período", <Money key="f" value={v.fixedPeriodAmount} currency={v.currency} />] : null,
                  v.quantityCapPerPeriod ? ["Tope de horas por período", formatDecimal(v.quantityCapPerPeriod, { minFraction: 0 })] : null,
                  ["Confirmada", v.confirmedAt ? formatDateTime(v.confirmedAt) : null],
                ]}
              />
              {v.items.length > 0 && (
                <div className="ledger-wrap">
                  <table className="ledger stack">
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Descripción</th>
                        <th className="hide-sm">Hito / unidad</th>
                        <th className="num">Cantidad</th>
                        <th className="num">Precio / importe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {v.items.map((it) => (
                        <tr key={it.id}>
                          <td className="mono">{it.code}</td>
                          <td>{it.description}</td>
                          <td className="hide-sm">{it.milestoneRef ?? it.unit ?? "—"}</td>
                          <td className="num" data-label="Cantidad">
                            {it.agreedQuantity ? formatDecimal(it.agreedQuantity, { minFraction: 0 }) : "—"}
                          </td>
                          <td className="num">{it.unitPrice ? <Money value={it.unitPrice} currency={v.currency} /> : <Money value={it.agreedAmount} currency={v.currency} />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
      {reject && <RejectVersion contractId={id} v={reject} onClose={() => setReject(null)} onDone={data.reload} />}
    </>
  );
}

function NewVersion({ contract, onDone, onCancel }) {
  const toast = useToast();
  const [v, setV] = useState(() => emptyVersion(contract.billingType));
  const [confirm, setConfirm] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const errors = validateVersion(contract.billingType, v);
  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length || busy) return;
    setBusy(true);
    try {
      await api(`/api/contracts/${contract.id}/versions`, { method: "POST", body: { version: toPayload(contract.billingType, v), confirm } });
      toast("Nueva versión registrada.");
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <form className={`${m.panel} ${m.newPanel}`} onSubmit={submit} noValidate>
      <h2 className={m.panelTitle}>Nueva versión de condiciones</h2>
      <VersionEditor type={contract.billingType} value={v} onChange={setV} errors={errors} show={touched} />
      <label style={{ display: "flex", gap: 10 }}>
        <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
        <span>Confirmar al guardar (si no, queda como borrador).</span>
      </label>
      {error && <ErrorPanel error={error} title="No se pudo registrar la versión" />}
      <div className={m.actions}>
        <Button type="submit" loading={busy}>
          Guardar versión
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function RejectVersion({ contractId, v, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const go = async () => {
    if (reason.trim().length < 3) return setError({ message: "Indica el motivo (mínimo 3 caracteres)." });
    setBusy(true);
    try {
      await api(`/api/contracts/${contractId}/versions/${v.id}/reject`, { method: "POST", body: { reason: reason.trim() } });
      onDone();
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog open title={`Rechazar versión ${v.versionNo}`} confirmLabel="Rechazar versión" tone="danger" busy={busy} onConfirm={go} onCancel={onClose}>
      <Field label="Motivo" required error={error?.message}>
        {(p) => <textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />}
      </Field>
    </ConfirmDialog>
  );
}
