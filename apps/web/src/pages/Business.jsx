import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Button, ErrorPanel, Notice, PageHeader, Skeleton } from "../components/ui.jsx";
import { IconFlask } from "../components/icons.jsx";
import { useResource } from "../lib/hooks.js";
import { formatDecimal, formatPeriod } from "../lib/format.js";
import { BUSINESS_STATUS } from "../components/StatusBadge.jsx";
import m from "./manage.module.css";
import s from "./Business.module.css";

const GROUPS = [
  { title: "Hechos medidos", hint: "Datos reales del sistema en el período.", keys: ["received", "analyzed", "automationRate", "authorizedVolume", "blockedVolume", "pendingHuman"] },
  { title: "Coste de IA (estimado)", hint: "Precio de lista por llamada registrada; no es la factura del proveedor.", keys: ["aiCost", "aiCostPerAnalysis"] },
  { title: "Ahorro y ROI (hipotético)", hint: "Depende de los supuestos indicados arriba; no incluye infraestructura.", keys: ["manualCostPerInvoice", "timeSaved", "manualCostAvoided", "netSavings", "roi"], hypothetical: true },
];

function show(metric) {
  const v = metric.value;
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return String(v);
  if (metric.unit === "%") return `${formatDecimal(v, { minFraction: 1, maxFraction: 1 })} %`;
  if (metric.unit === "×") return `${formatDecimal(v, { minFraction: 2, maxFraction: 2 })}×`;
  if (metric.unit === "horas") return `${formatDecimal(v, { minFraction: 2, maxFraction: 2 })} h`;
  if (metric.unit === "USD") return `${formatDecimal(v, { minFraction: 2, maxFraction: 6 })} USD`;
  return `${formatDecimal(v)} ${metric.unit}`;
}

/** Dashboard de negocio y ROI (RF-23 / RF-30): cada cifra explica su definición, denominador y fuente. */
export default function Business() {
  const [params, setParams] = useSearchParams();
  const qs = new URLSearchParams();
  for (const k of ["period", "reviewMinutes", "analystHourlyUsd"]) if (params.get(k)) qs.set(k, params.get(k));
  const data = useResource(`/api/business-metrics?${qs}`);
  const d = data.data;
  const [form, setForm] = useState(null);
  const f = form ?? { period: params.get("period") ?? "", reviewMinutes: params.get("reviewMinutes") ?? "", analystHourlyUsd: params.get("analystHourlyUsd") ?? "" };
  const byKey = Object.fromEntries((d?.metrics ?? []).map((x) => [x.key, x]));

  const apply = (e) => {
    e.preventDefault();
    const n = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (String(v).trim()) n.set(k, String(v).trim());
    setParams(n);
    setForm(null);
  };

  return (
    <>
      <PageHeader eyebrow="Operaciones" title="Negocio y ROI">
        Volumen, automatización, coste de IA y ahorro estimado del período. Los hechos medidos, el coste de IA y el ahorro hipotético se muestran por separado; cada cifra indica cómo se calcula.
      </PageHeader>

      <form className={s.assumptions} onSubmit={apply} aria-label="Período y supuestos">
        <label className={m.ctl}>
          <span>Período</span>
          <input type="month" value={f.period || d?.period || ""} onChange={(e) => setForm({ ...f, period: e.target.value })} />
        </label>
        <label className={m.ctl}>
          <span>Minutos de revisión manual por factura (supuesto)</span>
          <input type="number" min={1} max={240} value={f.reviewMinutes || d?.assumptions.reviewMinutes || ""} onChange={(e) => setForm({ ...f, reviewMinutes: e.target.value })} />
        </label>
        <label className={m.ctl}>
          <span>Coste por hora del analista, USD (supuesto)</span>
          <input inputMode="decimal" value={f.analystHourlyUsd || d?.assumptions.analystHourlyUsd || ""} onChange={(e) => setForm({ ...f, analystHourlyUsd: e.target.value })} />
        </label>
        <Button type="submit" variant="secondary" size="sm">
          Recalcular
        </Button>
      </form>

      {data.error ? (
        <ErrorPanel error={data.error} onRetry={data.reload} title="No se pudieron calcular las métricas" />
      ) : !d ? (
        <Skeleton lines={6} />
      ) : (
        <>
          <p className={s.period}>
            {formatPeriod(d.period)} · moneda base {d.baseCurrency} · supuestos: {d.assumptions.reviewMinutes} min/factura y {d.assumptions.analystHourlyUsd} USD/h
          </p>
          {GROUPS.map((g) => (
            <section key={g.title} className={s.group} data-hypothetical={g.hypothetical || undefined} aria-label={g.title}>
              <header>
                <h2>{g.title}</h2>
                <span className="muted">{g.hint}</span>
              </header>
              <div className={s.cards}>
                {g.keys.map((k) => byKey[k] && <MetricCard key={k} metric={byKey[k]} />)}
              </div>
            </section>
          ))}
          {Object.keys(d.outcomes).length > 0 && (
            <section className={s.group} aria-label="Resultados del período">
              <header>
                <h2>Resultados del período</h2>
                <Link to="/invoices" className={m.link}>
                  Ver facturas
                </Link>
              </header>
              <ul className={s.outcomes}>
                {Object.entries(d.outcomes).map(([k, n]) => (
                  <li key={k}>
                    <span>{BUSINESS_STATUS[k]?.label ?? k}</span>
                    <strong>{n}</strong>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <Notice tone="demo" icon={IconFlask}>
            Autorizaciones y reservas simuladas: ninguna cifra representa pagos reales. {d.note} Detalle del coste por etapa, modelo y factura en <Link to="/audit/ai-usage">Auditoría → Uso de IA</Link>.
          </Notice>
        </>
      )}
    </>
  );
}

function MetricCard({ metric }) {
  return (
    <article className={s.card} data-hypothetical={metric.hypothetical || undefined}>
      <span className={s.label}>
        {metric.label}
        {metric.hypothetical && <em> · hipotético</em>}
      </span>
      <strong className={s.value}>{show(metric)}</strong>
      <details className={s.how}>
        <summary>Cómo se calcula</summary>
        <p>{metric.definition}</p>
        {metric.denominator && <p>Denominador: {metric.denominator}</p>}
        <p className="mono">Fuente: {metric.source}</p>
      </details>
    </article>
  );
}
