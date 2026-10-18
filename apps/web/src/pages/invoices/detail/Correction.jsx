import { useState } from "react";
import { useNavigate } from "react-router";
import { Button, ButtonLink, ErrorPanel, Field, Notice } from "../../../components/ui.jsx";
import { IconPlus, IconClose } from "../../../components/icons.jsx";
import { api, uploadFile } from "../../../lib/api.js";
import { Dropzone, validateFile } from "../InvoiceNew.jsx";
import styles from "./Detail.module.css";

const MONEY = /^\d{1,15}(\.\d{1,4})?$/;
const QTY = /^\d{1,12}(\.\d{1,4})?$/;
const PRICE = /^\d{1,15}(\.\d{1,6})?$/;
const HEAD = [
  ["supplierInvoiceNumber", "Número de factura", "text"],
  ["issueDate", "Fecha de emisión", "date"],
  ["dueDate", "Vencimiento", "date"],
  ["servicePeriodStart", "Inicio del período de servicio", "date"],
  ["servicePeriodEnd", "Fin del período de servicio", "date"],
  ["currency", "Moneda (ISO 4217)", "text"],
  ["subtotal", "Subtotal", "money"],
  ["taxes", "Impuestos", "money"],
  ["totalAmount", "Total", "money"],
  ["contractRefCited", "Referencia de contrato citada", "text"],
  ["paymentDestinationRaw", "Destino de pago (tal como aparece)", "text"],
];
const strip = (v) => (v == null ? "" : String(v).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""));

/** Nueva versión corregida (inmutable) + reanálisis. Los valores deben aparecer en el documento aportado. */
export default function Correction({ c }) {
  const navigate = useNavigate();
  const v = c.currentVersion;
  const [data, setData] = useState(() => Object.fromEntries(HEAD.map(([k]) => [k, k === "currency" ? (v?.originalCurrency ?? "") : strip(v?.[k])])));
  const [lines, setLines] = useState(() => (v?.lines ?? []).map((l) => ({ concept: l.concept ?? "", itemRef: l.itemRef ?? "", quantity: strip(l.quantity), unit: l.unit ?? "", unitPrice: strip(l.unitPrice), subtotal: strip(l.subtotal) })));
  const [file, setFile] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [touched, setTouched] = useState(false);

  if (!v) return null;
  const errs = {};
  for (const [k, , t] of HEAD) if (t === "money" && data[k] && !MONEY.test(data[k])) errs[k] = "Importe decimal con punto, hasta 4 decimales (sin separador de miles).";
  if (data.currency && !/^[A-Z]{3}$/.test(data.currency)) errs.currency = "Código de 3 letras, p. ej. USD.";
  if (data.servicePeriodStart && data.servicePeriodEnd && data.servicePeriodEnd < data.servicePeriodStart) errs.servicePeriodEnd = "No puede ser anterior al inicio.";
  lines.forEach((l, i) => {
    if (!l.concept.trim()) errs[`l${i}concept`] = "Obligatorio";
    if (!MONEY.test(l.subtotal)) errs[`l${i}subtotal`] = "Importe inválido";
    if (l.quantity && !QTY.test(l.quantity)) errs[`l${i}quantity`] = "Cantidad inválida";
    if (l.unitPrice && !PRICE.test(l.unitPrice)) errs[`l${i}unitPrice`] = "Precio inválido";
  });
  if (reason.trim().length < 3) errs.reason = "Indica el motivo de la corrección.";
  const fileErr = file ? validateFile(file) : null;
  const ok = Object.keys(errs).length === 0 && !fileErr;

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      let documentId;
      if (file) {
        const up = await uploadFile("/api/documents?kind=INVOICE", file, { headers: { "X-File-Name": encodeURIComponent(file.name) } }).promise;
        documentId = up.document.id;
      }
      const clean = Object.fromEntries(Object.entries(data).filter(([, x]) => String(x).trim() !== "").map(([k, x]) => [k, String(x).trim()]));
      const body = {
        data: { ...clean, lines: lines.map((l) => Object.fromEntries(Object.entries(l).filter(([, x]) => String(x).trim() !== "").map(([k, x]) => [k, String(x).trim()]))) },
        reason: reason.trim(),
        ...(documentId ? { documentId } : {}),
      };
      await api(`/api/invoices/${c.id}/versions`, { method: "POST", body });
      const r = await api(`/api/invoices/${c.id}/analysis`, { method: "POST", body: { justification: `Corrección: ${reason.trim()}`.slice(0, 500) } });
      c.reloadAll();
      navigate(`/invoices/${c.id}?run=${r.runId}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  const show = (k) => (touched ? errs[k] : null);

  return (
    <form className={styles.correction} onSubmit={submit} noValidate>
      <Notice tone="info" title={`Corregir la versión ${v.versionNo}`}>
        Se crea una versión nueva (las anteriores no se modifican) y se reanaliza. Cada valor se coteja con el texto del documento: si cambian los datos, aporta el documento que los respalda.
      </Notice>
      <div className={styles.formGrid}>
        {HEAD.map(([k, label, t]) => (
          <Field key={k} label={label} error={show(k)}>
            {(p) => <input {...p} type={t === "date" ? "date" : "text"} inputMode={t === "money" ? "decimal" : undefined} value={data[k]} onChange={(e) => setData({ ...data, [k]: k === "currency" ? e.target.value.toUpperCase() : e.target.value })} />}
          </Field>
        ))}
      </div>

      <fieldset className={styles.linesEdit}>
        <legend>Líneas</legend>
        {lines.map((l, i) => (
          <div key={i} className={styles.lineRow}>
            {[
              ["concept", "Concepto"],
              ["itemRef", "Ítem"],
              ["quantity", "Cantidad"],
              ["unit", "Unidad"],
              ["unitPrice", "Precio unit."],
              ["subtotal", "Subtotal"],
            ].map(([k, label]) => (
              <Field key={k} label={`${label}`} error={show(`l${i}${k}`)} required={k === "concept" || k === "subtotal"}>
                {(p) => <input {...p} value={l[k]} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />}
              </Field>
            ))}
            <button type="button" className={styles.iconBtn} onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label={`Quitar línea ${i + 1}`}>
              <IconClose size={16} />
            </button>
          </div>
        ))}
        <Button type="button" variant="ghost" size="sm" icon={IconPlus} onClick={() => setLines([...lines, { concept: "", itemRef: "", quantity: "", unit: "", unitPrice: "", subtotal: "" }])}>
          Añadir línea
        </Button>
      </fieldset>

      <div>
        <p className={styles.label}>Documento que respalda la corrección (recomendado)</p>
        <Dropzone label="Documento corregido" file={file} onFile={setFile} error={fileErr} compact disabled={busy} />
      </div>
      <Field label="Motivo de la corrección" required error={show("reason")}>
        {(p) => <textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}
      </Field>
      {error && <ErrorPanel error={error} title="No se pudo guardar la corrección" />}
      <div className={styles.actions}>
        <Button type="submit" loading={busy}>
          Guardar versión y reanalizar
        </Button>
        <ButtonLink to={`/invoices/${c.id}`} variant="ghost">
          Cancelar
        </ButtonLink>
      </div>
    </form>
  );
}
