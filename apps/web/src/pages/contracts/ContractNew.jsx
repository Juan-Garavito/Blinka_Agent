import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { BILLING_TYPE } from "../../components/VendorStatus.jsx";
import { Button, ButtonLink, ErrorPanel, Field, Notice, PageHeader, useToast } from "../../components/ui.jsx";
import { api } from "../../lib/api.js";
import { useResource } from "../../lib/hooks.js";
import { emptyVersion, toPayload, validateVersion, VersionEditor } from "./VersionEditor.jsx";
import m from "../manage.module.css";
import s from "./contracts.module.css";

const TYPE_HELP = {
  RECURRING: "Importe fijo por período (mensual, trimestral, anual).",
  HOURLY: "Tarifas por hora y tope opcional de horas por período.",
  MILESTONE: "Entregables con importe acordado y acta de aceptación.",
  PURCHASE_ORDER: "Líneas con cantidad y precio unitario acordados.",
};

export default function ContractNew() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const vendors = useResource("/api/vendors");
  const categories = useResource("/api/categories");
  const [head, setHead] = useState({ vendorId: params.get("vendorId") ?? "", categoryId: "", contractRef: "", billingType: "HOURLY" });
  const [version, setVersion] = useState(() => emptyVersion("HOURLY"));
  const [confirm, setConfirm] = useState(true);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const errors = {
    ...validateVersion(head.billingType, version),
    ...(head.vendorId ? {} : { vendorId: "Selecciona el proveedor." }),
    ...(head.categoryId ? {} : { categoryId: "Selecciona la categoría de gasto." }),
    ...(head.contractRef.trim() ? {} : { contractRef: "Obligatoria." }),
  };
  const setType = (t) => {
    setHead({ ...head, billingType: t });
    setVersion(emptyVersion(t));
  };
  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api("/api/contracts", { method: "POST", body: { ...head, contractRef: head.contractRef.trim(), version: toPayload(head.billingType, version), confirm } });
      toast(`Contrato ${res.contract.contractRef} registrado${confirm ? " y confirmado" : " como borrador"}.`);
      navigate(`/contracts/${res.contract.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  const err = (k) => (touched ? errors[k] : null);

  return (
    <>
      <PageHeader breadcrumbs={[{ to: "/contracts", label: "Contratos" }, { label: "Nuevo contrato" }]} title="Nuevo contrato">
        Las condiciones se validan por modalidad. Un contrato solo se usa para decidir cuando una persona confirma su versión.
      </PageHeader>
      <form className={m.stack} onSubmit={submit} noValidate>
        <section className={m.panel}>
          <div className={m.formGrid}>
            <Field label="Proveedor" required error={err("vendorId")}>
              {(p) => (
                <select {...p} value={head.vendorId} onChange={(e) => setHead({ ...head, vendorId: e.target.value })}>
                  <option value="">Selecciona…</option>
                  {(vendors.data?.vendors ?? []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.legalName}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Categoría de gasto" required error={err("categoryId")}>
              {(p) => (
                <select {...p} value={head.categoryId} onChange={(e) => setHead({ ...head, categoryId: e.target.value })}>
                  <option value="">Selecciona…</option>
                  {(categories.data?.categories ?? []).filter((c) => c.active).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Referencia del contrato" required error={err("contractRef")}>
              {(p) => <input {...p} value={head.contractRef} maxLength={80} onChange={(e) => setHead({ ...head, contractRef: e.target.value })} />}
            </Field>
          </div>
          <fieldset className={s.types}>
            <legend>Modalidad de facturación</legend>
            {Object.entries(BILLING_TYPE).map(([k, l]) => (
              <label key={k} data-checked={head.billingType === k || undefined}>
                <input type="radio" name="billingType" checked={head.billingType === k} onChange={() => setType(k)} />
                <strong>{l}</strong>
                <span className="muted">{TYPE_HELP[k]}</span>
              </label>
            ))}
          </fieldset>
        </section>
        <section className={m.panel}>
          <h2 className={m.panelTitle}>Versión 1 · condiciones</h2>
          <VersionEditor type={head.billingType} value={version} onChange={setVersion} errors={errors} show={touched} />
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} style={{ marginTop: 4 }} />
            <span>
              <strong>Confirmo que estas condiciones corresponden al contrato firmado.</strong>
              <span className="muted"> Sin confirmación queda como borrador y el motor no lo usa.</span>
            </span>
          </label>
        </section>
        {touched && Object.keys(errors).length > 0 && <Notice tone="warning">Revisa los campos marcados.</Notice>}
        {error && <ErrorPanel error={error} title="No se pudo registrar el contrato" />}
        <div className={m.actions}>
          <Button type="submit" loading={busy}>
            Registrar contrato
          </Button>
          <ButtonLink to="/contracts" variant="ghost">
            Cancelar
          </ButtonLink>
        </div>
      </form>
    </>
  );
}
