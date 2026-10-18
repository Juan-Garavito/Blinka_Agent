import { Button, Field } from "../../components/ui.jsx";
import { IconClose, IconPlus } from "../../components/icons.jsx";
import m from "../manage.module.css";
import s from "./contracts.module.css";

const MONEY = /^\d{1,16}(\.\d{1,4})?$/;
const PRICE = /^\d{1,14}(\.\d{1,6})?$/;
const CODE = /^[A-Za-z0-9._-]{1,40}$/;
export const FREQUENCIES = { MONTHLY: "Mensual", QUARTERLY: "Trimestral", ANNUAL: "Anual" };

/** Campos de ítem por modalidad (ER §B: no todos los campos aplican a todos los tipos). */
const ITEM_FIELDS = {
  RECURRING: { kind: "FIXED_FEE", fields: [["code", "Código"], ["description", "Descripción"], ["agreedAmount", "Importe acordado", MONEY]] },
  HOURLY: { kind: "HOURLY_RATE", fields: [["code", "Código"], ["description", "Descripción"], ["unitPrice", "Tarifa por hora", PRICE]] },
  MILESTONE: { kind: "MILESTONE", fields: [["code", "Código"], ["description", "Descripción"], ["milestoneRef", "Referencia del hito"], ["agreedAmount", "Importe del hito", MONEY]] },
  PURCHASE_ORDER: { kind: "PO_LINE", fields: [["code", "Código"], ["description", "Descripción"], ["unit", "Unidad"], ["agreedQuantity", "Cantidad acordada", MONEY], ["unitPrice", "Precio unitario", PRICE]] },
};

export const emptyVersion = (type) => ({
  currency: "USD",
  effectiveFrom: "",
  effectiveTo: "",
  billingFrequency: type === "RECURRING" || type === "HOURLY" ? "MONTHLY" : "",
  fixedPeriodAmount: "",
  quantityCapPerPeriod: "",
  items: type === "RECURRING" ? [] : [Object.fromEntries(ITEM_FIELDS[type].fields.map(([k]) => [k, ""]))],
});

export function validateVersion(type, v) {
  const e = {};
  if (!/^[A-Z]{3}$/.test(v.currency)) e.currency = "Código ISO de 3 letras.";
  if (!v.effectiveFrom) e.effectiveFrom = "Obligatoria.";
  if (v.effectiveTo && v.effectiveFrom && v.effectiveTo < v.effectiveFrom) e.effectiveTo = "No puede ser anterior al inicio.";
  if (type === "RECURRING") {
    if (!MONEY.test(v.fixedPeriodAmount) || /^0+(\.0+)?$/.test(v.fixedPeriodAmount)) e.fixedPeriodAmount = "Importe mayor que 0 (punto decimal, hasta 4 decimales).";
  }
  if (type === "HOURLY" && v.quantityCapPerPeriod && !MONEY.test(v.quantityCapPerPeriod)) e.quantityCapPerPeriod = "Cantidad decimal.";
  if (type === "HOURLY" && v.quantityCapPerPeriod && !v.billingFrequency) e.billingFrequency = "El tope requiere una frecuencia.";
  if (type !== "RECURRING" && v.items.length === 0) e.items = "Añade al menos un ítem.";
  const codes = new Set();
  v.items.forEach((it, i) => {
    for (const [k, , re] of ITEM_FIELDS[type].fields) {
      const val = (it[k] ?? "").trim();
      if (k === "unit" && !val) continue;
      if (!val) e[`i${i}${k}`] = "Obligatorio";
      else if (re && !re.test(val)) e[`i${i}${k}`] = "Formato inválido";
      else if (k === "code" && !CODE.test(val)) e[`i${i}${k}`] = "Solo letras, números, . _ -";
    }
    if (codes.has(it.code)) e[`i${i}code`] = "Código duplicado";
    codes.add(it.code);
  });
  return e;
}

export function toPayload(type, v) {
  const out = { currency: v.currency, effectiveFrom: v.effectiveFrom, ...(v.effectiveTo ? { effectiveTo: v.effectiveTo } : {}) };
  if (type === "RECURRING") Object.assign(out, { billingFrequency: v.billingFrequency, fixedPeriodAmount: v.fixedPeriodAmount });
  if (type === "HOURLY") Object.assign(out, v.billingFrequency ? { billingFrequency: v.billingFrequency } : {}, v.quantityCapPerPeriod ? { quantityCapPerPeriod: v.quantityCapPerPeriod } : {});
  out.items = v.items.map((it) => ({
    kind: ITEM_FIELDS[type].kind,
    ...Object.fromEntries(ITEM_FIELDS[type].fields.filter(([k]) => (it[k] ?? "").trim() !== "").map(([k]) => [k, it[k].trim()])),
    ...(type === "HOURLY" ? { unit: "HOUR" } : {}),
  }));
  return out;
}

export function VersionEditor({ type, value: v, onChange, errors, show }) {
  const set = (patch) => onChange({ ...v, ...patch });
  const err = (k) => (show ? errors[k] : null);
  const spec = ITEM_FIELDS[type];
  return (
    <div className={s.editor}>
      <div className={m.formGrid}>
        <Field label="Moneda del contrato" required error={err("currency")}>
          {(p) => <input {...p} value={v.currency} maxLength={3} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} />}
        </Field>
        <Field label="Vigente desde" required error={err("effectiveFrom")}>
          {(p) => <input {...p} type="date" value={v.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} />}
        </Field>
        <Field label="Vigente hasta" error={err("effectiveTo")} hint="Opcional">
          {(p) => <input {...p} type="date" value={v.effectiveTo} onChange={(e) => set({ effectiveTo: e.target.value })} />}
        </Field>
        {(type === "RECURRING" || type === "HOURLY") && (
          <Field label="Frecuencia de facturación" required={type === "RECURRING"} error={err("billingFrequency")}>
            {(p) => (
              <select {...p} value={v.billingFrequency} onChange={(e) => set({ billingFrequency: e.target.value })}>
                {type === "HOURLY" && <option value="">Sin frecuencia</option>}
                {Object.entries(FREQUENCIES).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        {type === "RECURRING" && (
          <Field label="Importe por período" required error={err("fixedPeriodAmount")}>
            {(p) => <input {...p} inputMode="decimal" value={v.fixedPeriodAmount} onChange={(e) => set({ fixedPeriodAmount: e.target.value })} />}
          </Field>
        )}
        {type === "HOURLY" && (
          <Field label="Tope de horas por período" error={err("quantityCapPerPeriod")} hint="Acumulado de facturas autorizadas en el período de servicio">
            {(p) => <input {...p} inputMode="decimal" value={v.quantityCapPerPeriod} onChange={(e) => set({ quantityCapPerPeriod: e.target.value })} />}
          </Field>
        )}
      </div>
      <fieldset className={s.items}>
        <legend>{type === "RECURRING" ? "Conceptos fijos (opcional)" : "Ítems"}</legend>
        {show && errors.items && <p className={s.err}>{errors.items}</p>}
        {v.items.map((it, i) => (
          <div key={i} className={s.itemRow} style={{ "--cols": spec.fields.length }}>
            {spec.fields.map(([k, label]) => (
              <Field key={k} label={label} required={k !== "unit"} error={err(`i${i}${k}`)}>
                {(p) => <input {...p} value={it[k] ?? ""} onChange={(e) => set({ items: v.items.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) })} />}
              </Field>
            ))}
            <button type="button" className={s.remove} onClick={() => set({ items: v.items.filter((_, j) => j !== i) })} aria-label={`Quitar ítem ${i + 1}`}>
              <IconClose size={16} />
            </button>
          </div>
        ))}
        <Button type="button" variant="ghost" size="sm" icon={IconPlus} onClick={() => set({ items: [...v.items, Object.fromEntries(spec.fields.map(([k]) => [k, ""]))] })}>
          Añadir ítem
        </Button>
      </fieldset>
    </div>
  );
}
