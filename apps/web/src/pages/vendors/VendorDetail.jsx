import { useState } from "react";
import { Link, useParams } from "react-router";
import { BILLING_TYPE, VENDOR_STATUS, VendorStatusBadge } from "../../components/VendorStatus.jsx";
import { StatusBadge } from "../../components/StatusBadge.jsx";
import { Money } from "../../components/Money.jsx";
import { Button, ButtonLink, ConfirmDialog, ErrorPanel, Field, KeyValue, PageHeader, Skeleton, useToast } from "../../components/ui.jsx";
import { IconArrowRight, IconPlus, IconShield } from "../../components/icons.jsx";
import { api } from "../../lib/api.js";
import { useResource } from "../../lib/hooks.js";
import { formatDateTime } from "../../lib/format.js";
import { NotFound } from "../System.jsx";
import m from "../manage.module.css";

const ACCOUNT_STATUS = { AUTHORIZED: "Habilitada", PENDING: "Pendiente", BLOCKED: "Bloqueada" };

export default function VendorDetail() {
  const { id } = useParams();
  const data = useResource(`/api/vendors/${id}`);
  const contracts = useResource("/api/contracts");
  const invoices = useResource(`/api/invoices?vendorId=${id}&limit=8`);
  const [change, setChange] = useState(null); // { target: "vendor"|accountId, status }

  if (data.error?.status === 404 || data.error?.code === "VALIDATION_ERROR") return <NotFound what="El proveedor no existe o no pertenece a tu empresa." />;
  if (data.error) return <ErrorPanel error={data.error} onRetry={data.reload} />;
  if (!data.data) return <Skeleton lines={8} />;
  const { vendor, bankAccounts } = data.data;
  const own = (contracts.data?.contracts ?? []).filter((c) => c.vendorId === id);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ to: "/vendors", label: "Proveedores" }, { label: vendor.legalName }]}
        eyebrow={`NIT ${vendor.taxReference ?? "—"}`}
        title={vendor.legalName}
        actions={
          <ButtonLink to={`/invoices/new?vendorId=${vendor.id}`} icon={IconPlus} variant="secondary">
            Nueva factura de este proveedor
          </ButtonLink>
        }
      />
      <div className={m.two}>
        <div className={m.stack}>
          <section className={m.panel} aria-labelledby="vs-h">
            <div className={m.panelHead}>
              <h2 id="vs-h" className={m.panelTitle}>
                Estado del proveedor
              </h2>
              <VendorStatusBadge status={vendor.status} size="md" />
            </div>
            <p className="muted">{VENDOR_STATUS[vendor.status]?.consequence}</p>
            <div className={m.actions}>
              {Object.keys(VENDOR_STATUS)
                .filter((s) => s !== vendor.status)
                .map((s) => (
                  <Button key={s} variant={s === "BLOCKED" ? "danger" : "secondary"} size="sm" onClick={() => setChange({ target: "vendor", status: s, label: vendor.legalName })}>
                    {s === "AUTHORIZED" ? "Habilitar" : s === "BLOCKED" ? "Bloquear" : "Volver a pendiente"}
                  </Button>
                ))}
            </div>
            <p className={m.fine}>Cambiar el estado no reevalúa facturas ya decididas; reanaliza la factura afectada desde su detalle.</p>
          </section>

          <section className={m.panel} aria-labelledby="ba-h">
            <h2 id="ba-h" className={m.panelTitle}>
              <IconShield size={16} /> Cuentas bancarias
            </h2>
            {bankAccounts.length === 0 ? (
              <p className="muted">Sin cuentas registradas. Sin cuenta habilitada, las facturas no pueden autorizarse.</p>
            ) : (
              <ul className={m.mini}>
                {bankAccounts.map((a) => (
                  <li key={a.id}>
                    <span>
                      <strong className="mono">{a.accountMask}</strong> <span className="muted">· {a.country} · {a.currency}</span>
                    </span>
                    <span className={m.rowActions}>
                      <span className="muted">{ACCOUNT_STATUS[a.status] ?? a.status}</span>
                      {Object.keys(ACCOUNT_STATUS)
                        .filter((s) => s !== a.status)
                        .map((s) => (
                          <Button key={s} size="sm" variant={s === "BLOCKED" ? "danger" : "ghost"} onClick={() => setChange({ target: a.id, status: s, label: `cuenta ${a.accountMask}` })}>
                            {s === "AUTHORIZED" ? "Habilitar" : s === "BLOCKED" ? "Bloquear" : "Pendiente"}
                          </Button>
                        ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <NewAccount vendorId={id} onDone={data.reload} />
          </section>
        </div>

        <div className={m.stack}>
          <section className={m.panel} aria-labelledby="vc-h">
            <div className={m.panelHead}>
              <h2 id="vc-h" className={m.panelTitle}>
                Contratos
              </h2>
              <Link className={m.link} to={`/contracts/new?vendorId=${id}`}>
                Nuevo contrato <IconArrowRight size={14} />
              </Link>
            </div>
            {!contracts.data ? (
              <Skeleton lines={2} />
            ) : own.length === 0 ? (
              <p className="muted">Sin contratos. Las facturas sin contrato vigente van a corrección.</p>
            ) : (
              <ul className={m.mini}>
                {own.map((c) => (
                  <li key={c.id}>
                    <Link to={`/contracts/${c.id}`}>{c.contractRef}</Link>
                    <span className="muted">
                      {BILLING_TYPE[c.billingType]} · {c.status === "ACTIVE" ? "vigente" : c.status.toLowerCase()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={m.panel} aria-labelledby="vi-h">
            <div className={m.panelHead}>
              <h2 id="vi-h" className={m.panelTitle}>
                Facturas recientes
              </h2>
              <Link className={m.link} to={`/invoices?vendorId=${id}`}>
                Ver todas <IconArrowRight size={14} />
              </Link>
            </div>
            {!invoices.data ? (
              <Skeleton lines={3} />
            ) : invoices.data.invoices.length === 0 ? (
              <p className="muted">Sin facturas.</p>
            ) : (
              <ul className={m.mini}>
                {invoices.data.invoices.map((i) => (
                  <li key={i.id}>
                    <Link to={`/invoices/${i.id}`}>{i.supplierInvoiceNumber ?? "Sin número"}</Link>
                    <span className={m.rowActions}>
                      <Money value={i.totalAmount} currency={i.currency} />
                      <StatusBadge status={i.status} processing={i.processing} size="sm" />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={m.panel}>
            <KeyValue
              columns={1}
              items={[
                ["Registrado", formatDateTime(vendor.createdAt)],
                ["Última actualización", formatDateTime(vendor.updatedAt)],
              ]}
            />
            <Link className={m.link} to={`/audit?entityRef=${id}`}>
              Ver auditoría del proveedor <IconArrowRight size={14} />
            </Link>
          </section>
        </div>
      </div>
      {change && <StatusChange vendorId={id} change={change} onClose={() => setChange(null)} onDone={data.reload} />}
    </>
  );
}

function StatusChange({ vendorId, change, onClose, onDone }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const verb = change.status === "AUTHORIZED" ? "Habilitar" : change.status === "BLOCKED" ? "Bloquear" : "Volver a pendiente";
  const confirm = async () => {
    if (reason.trim().length < 3) return setError({ message: "Indica el motivo (mínimo 3 caracteres)." });
    setBusy(true);
    setError(null);
    try {
      const path = change.target === "vendor" ? `/api/vendors/${vendorId}/status` : `/api/vendors/${vendorId}/bank-accounts/${change.target}/status`;
      await api(path, { method: "POST", body: { status: change.status, reason: reason.trim() } });
      toast(`${verb}: ${change.label}. Cambio auditado.`);
      onDone();
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog open title={`${verb} ${change.label}`} confirmLabel={verb} tone={change.status === "BLOCKED" ? "danger" : "primary"} busy={busy} onConfirm={confirm} onCancel={onClose}>
      <Field label="Motivo" required error={error?.message}>
        {(p) => <textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />}
      </Field>
      <p className="muted">El cambio queda registrado en la auditoría con tu usuario.</p>
    </ConfirmDialog>
  );
}

function NewAccount({ vendorId, onDone }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ country: "CO", currency: "USD", accountNumber: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [touched, setTouched] = useState(false);
  const errs = {
    country: /^[A-Z]{2}$/.test(f.country) ? null : "Código ISO de 2 letras.",
    currency: /^[A-Z]{3}$/.test(f.currency) ? null : "Código ISO de 3 letras.",
    accountNumber: /^[A-Z0-9]{6,34}$/.test(f.accountNumber.replace(/[\s-]/g, "").toUpperCase()) ? null : "Número/IBAN de 6 a 34 caracteres alfanuméricos.",
  };
  if (!open)
    return (
      <Button variant="ghost" size="sm" icon={IconPlus} onClick={() => setOpen(true)}>
        Registrar cuenta
      </Button>
    );
  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (Object.values(errs).some(Boolean) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { bankAccount } = await api(`/api/vendors/${vendorId}/bank-accounts`, { method: "POST", body: f });
      toast(`Cuenta ${bankAccount.accountMask} registrada como pendiente.`);
      setF({ country: "CO", currency: "USD", accountNumber: "" });
      setOpen(false);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} noValidate style={{ display: "grid", gap: 12, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
      <div className={m.formGrid}>
        <Field label="País" required error={touched ? errs.country : null}>
          {(p) => <input {...p} value={f.country} maxLength={2} onChange={(e) => setF({ ...f, country: e.target.value.toUpperCase() })} />}
        </Field>
        <Field label="Moneda" required error={touched ? errs.currency : null}>
          {(p) => <input {...p} value={f.currency} maxLength={3} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} />}
        </Field>
        <Field label="Número de cuenta / IBAN" required error={touched ? errs.accountNumber : null} hint="Se guarda solo una huella HMAC y una máscara; el número completo no se almacena ni se muestra.">
          {(p) => <input {...p} value={f.accountNumber} autoComplete="off" onChange={(e) => setF({ ...f, accountNumber: e.target.value })} />}
        </Field>
      </div>
      {error && <ErrorPanel error={error} title="No se pudo registrar la cuenta" />}
      <div className={m.actions}>
        <Button type="submit" size="sm" loading={busy}>
          Guardar cuenta
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
