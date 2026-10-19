import { useState } from "react";
import { Link, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router";
import { Button, EmptyState, ErrorPanel, PageHeader, Skeleton } from "../components/ui.jsx";
import { IconFlask } from "../components/icons.jsx";
import { api } from "../lib/api.js";
import { useResource } from "../lib/hooks.js";
import { formatDate, formatDateTime, formatDecimal, shortId } from "../lib/format.js";
import m from "./manage.module.css";
import s from "./Audit.module.css";

const PAGE = 50;
const ACTOR = { USER: "Persona", SYSTEM: "Sistema", AGENT: "Agente IA" };
const ENTITY_ROUTE = { invoice: "/invoices/", vendor: "/vendors/", contract: "/contracts/", policy: "/policies/" };
const ENTITY_LABEL = { invoice: "Factura", vendor: "Proveedor", contract: "Contrato", policy: "Política", approval_request: "Aprobación", evaluation_flow: "Trámite", budget: "Presupuesto", monthly_budget: "Presupuesto", user: "Usuario", session: "Sesión", document: "Documento" };

export default function Audit() {
  const { pathname } = useLocation();
  const usage = pathname.startsWith("/audit/ai-usage");
  return (
    <>
      <PageHeader eyebrow="Auditoría" title={usage ? "Uso de IA" : "Eventos de auditoría"}>
        Registro append-only de la empresa: quién hizo qué y cuándo (personas, sistema y agente). Los detalles nunca incluyen secretos ni documentos.
      </PageHeader>
      {/* Eventos / Uso de IA se eligen en la navegación contextual del grupo Auditoría. */}
      <Routes>
        <Route index element={<Events />} />
        <Route path="ai-usage" element={<AiUsage />} />
      </Routes>
    </>
  );
}

function Events() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const qs = new URLSearchParams();
  for (const k of ["entityType", "entityRef", "eventType", "actorKind"]) if (params.get(k)) qs.set(k, params.get(k));
  qs.set("limit", String(PAGE));
  qs.set("offset", String((page - 1) * PAGE));
  const data = useResource(`/api/audit-events?${qs}`);
  const [eventType, setEventType] = useState(params.get("eventType") ?? "");
  const set = (patch) => {
    const n = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? n.set(k, v) : n.delete(k));
    if (!("page" in patch)) n.delete("page");
    setParams(n);
  };
  const events = data.data?.events ?? [];

  return (
    <>
      <form
        className={m.toolbar}
        onSubmit={(e) => {
          e.preventDefault();
          set({ eventType: eventType.trim() });
        }}
      >
        <label className={m.ctl}>
          <span>Actor</span>
          <select value={params.get("actorKind") ?? ""} onChange={(e) => set({ actorKind: e.target.value })}>
            <option value="">Todos</option>
            {Object.entries(ACTOR).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className={m.ctl}>
          <span>Entidad</span>
          <select value={params.get("entityType") ?? ""} onChange={(e) => set({ entityType: e.target.value })}>
            <option value="">Todas</option>
            {["invoice", "vendor", "contract", "policy", "approval_request", "evaluation_flow"].map((k) => (
              <option key={k} value={k}>
                {ENTITY_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className={m.ctl}>
          <span>Tipo de evento (exacto)</span>
          <input value={eventType} onChange={(e) => setEventType(e.target.value)} placeholder="p. ej. evaluation.completed" pattern="[a-z][a-z0-9_.]{2,80}" />
        </label>
        <Button type="submit" size="sm" variant="secondary">
          Filtrar
        </Button>
        {params.get("entityRef") && (
          <span className={s.chip}>
            Entidad {shortId(params.get("entityRef"))}
            <button type="button" onClick={() => set({ entityRef: "" })} aria-label="Quitar filtro de entidad">
              ×
            </button>
          </span>
        )}
      </form>
      {data.error ? (
        <ErrorPanel error={data.error} onRetry={data.reload} />
      ) : !data.data ? (
        <Skeleton lines={8} />
      ) : events.length === 0 ? (
        <EmptyState title="Sin eventos para estos filtros" />
      ) : (
        <ol className={s.events}>
          {events.map((e) => (
            <EventRow key={e.id} e={e} />
          ))}
        </ol>
      )}
      <nav className={s.pager} aria-label="Paginación">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => set({ page: page > 2 ? String(page - 1) : "" })}>
          Más recientes
        </Button>
        <span className="muted">Página {page}</span>
        <Button size="sm" variant="secondary" disabled={events.length < PAGE} onClick={() => set({ page: String(page + 1) })}>
          Más antiguos
        </Button>
      </nav>
    </>
  );
}

function EventRow({ e }) {
  const [open, setOpen] = useState(false);
  const route = ENTITY_ROUTE[e.entityType];
  const hasDetails = e.details && Object.keys(e.details).length > 0;
  return (
    <li className={s.event}>
      <time dateTime={e.occurredAt}>{formatDateTime(e.occurredAt)}</time>
      <span className={s.actor} data-kind={e.actorKind}>
        {ACTOR[e.actorKind] ?? e.actorKind}
        <span className="muted mono"> {e.actorKind === "USER" ? shortId(e.actorRef) : e.actorRef}</span>
      </span>
      <span className="mono">{e.eventType}</span>
      <span>
        {ENTITY_LABEL[e.entityType] ?? e.entityType}{" "}
        {e.entityRef && (route ? <Link to={`${route}${e.entityRef}`}>{shortId(e.entityRef)}</Link> : <span className="mono muted">{shortId(e.entityRef)}</span>)}
      </span>
      {hasDetails && (
        <button type="button" className={s.toggle} onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Ocultar" : "Detalles"}
        </button>
      )}
      {open && <pre className={s.details}>{JSON.stringify(e.details, null, 2)}</pre>}
    </li>
  );
}

function AiUsage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const data = useResource(`/api/ai-usage?limit=${PAGE}&offset=${(page - 1) * PAGE}`);
  const navigate = useNavigate();
  const rows = data.data?.usage ?? [];
  const openRun = async (runId) => {
    const r = await api(`/api/evaluation-runs/${runId}`).catch(() => null);
    if (r?.invoiceId) navigate(`/invoices/${r.invoiceId}/investigation`);
  };
  return (
    <>
      <CostSummary />
      <h2 className={s.h2}>Detalle por llamada</h2>
      {rows.some((u) => u.isSimulated) && (
        <p className={m.fine} style={{ marginBottom: 12 }}>
          <IconFlask size={14} /> Las filas marcadas como simuladas provienen del proveedor FAKE (MOCK): tokens estimados y costo 0; no se llamó a un modelo real.
        </p>
      )}
      {data.error ? (
        <ErrorPanel error={data.error} onRetry={data.reload} />
      ) : !data.data ? (
        <Skeleton lines={8} />
      ) : rows.length === 0 ? (
        <EmptyState title="Sin llamadas registradas" />
      ) : (
        <div className="ledger-wrap">
          <table className="ledger stack">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Proveedor · modelo</th>
                <th>Tarea</th>
                <th className="num">Tokens (entrada/salida)</th>
                <th className="num">Costo estimado (USD)</th>
                <th>Resultado</th>
                <th className="hide-sm">Corrida</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td className="muted">{formatDateTime(u.createdAt)}</td>
                  <td>
                    {u.isSimulated && <span className={s.sim}>Simulado</span>} {u.provider}
                    <span className="sub mono">{u.model}</span>
                  </td>
                  <td>{u.taskType}</td>
                  <td className="num" data-label="Tokens">
                    {u.inputTokens} / {u.outputTokens}
                  </td>
                  <td className="num" data-label="Costo">
                    {formatDecimal(u.estimatedCostUsd, { minFraction: 2, maxFraction: 8 })}
                  </td>
                  <td>
                    {u.status} <span className="muted">· {u.latencyMs} ms</span>
                  </td>
                  <td className="hide-sm">
                    {u.evaluationRunId && (
                      <button type="button" className={s.toggle} onClick={() => openRun(u.evaluationRunId)}>
                        {shortId(u.evaluationRunId)}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav className={s.pager} aria-label="Paginación">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setParams(page > 2 ? { page: String(page - 1) } : {})}>
          Más recientes
        </Button>
        <span className="muted">Página {page}</span>
        <Button size="sm" variant="secondary" disabled={rows.length < PAGE} onClick={() => setParams({ page: String(page + 1) })}>
          Más antiguas
        </Button>
      </nav>
    </>
  );
}

const STAGE_LABEL = { EXTRACT_CLASSIFY: "Extracción y clasificación", CONTRACT_MATCH: "Búsqueda de contrato", CONTRACT_VALIDATE: "Validación", FINANCIAL_DECISION: "Decisión", INVOICE_EXTRACTION: "Extracción de factura" };
const usd = (v) => formatDecimal(v, { minFraction: 2, maxFraction: 6 });

/** Totalizado del coste ESTIMADO de IA (RF-30): filtros de fecha en la URL, total, etapa, modelo, día y factura. */
function CostSummary() {
  const [params, setParams] = useSearchParams();
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const sum = useResource(`/api/ai-usage/summary?${qs}`);
  const setRange = (k, v) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    n.delete("page");
    setParams(n);
  };
  const d = sum.data;
  const real = d?.totals.find((t) => !t.isSimulated);
  const sim = d?.totals.find((t) => t.isSimulated);

  return (
    <section className={s.summary} aria-labelledby="cost-h">
      <div className={s.summaryHead}>
        <h2 id="cost-h" className={s.h2}>
          Coste de IA
        </h2>
        <div className={m.toolbar} style={{ margin: 0 }}>
          <label className={m.ctl}>
            <span>Desde</span>
            <input type="date" value={from} onChange={(e) => setRange("from", e.target.value)} />
          </label>
          <label className={m.ctl}>
            <span>Hasta</span>
            <input type="date" value={to} onChange={(e) => setRange("to", e.target.value)} />
          </label>
        </div>
      </div>
      {sum.error ? (
        <ErrorPanel error={sum.error} onRetry={sum.reload} />
      ) : !d ? (
        <Skeleton lines={3} />
      ) : (
        <>
          <div className={s.kpis}>
            <Kpi label="Coste estimado (IA real)" value={`${usd(real?.estimatedCostUsd ?? "0")} USD`} strong />
            <Kpi label="Llamadas reales" value={real?.calls ?? 0} />
            <Kpi label="Análisis con IA real" value={real?.analyses ?? 0} />
            <Kpi label="Coste medio por análisis" value={`${usd(real?.averagePerAnalysisUsd ?? "0")} USD`} />
            <Kpi label="Tokens (entrada / salida)" value={`${real?.inputTokens ?? 0} / ${real?.outputTokens ?? 0}`} />
          </div>
          <p className={m.fine}>
            <IconFlask size={14} />
            {d.pricing && !d.pricing.simulated
              ? `Precio de referencia vigente: ${d.pricing.model} · ${d.pricing.inputUsdPerMTok} USD/1M entrada · ${d.pricing.outputUsdPerMTok} USD/1M salida (incluye pensamiento). `
              : ""}
            Coste estimado de lista, no la factura del proveedor.
            {sim ? ` Llamadas simuladas (MOCK, coste 0): ${sim.calls}.` : ""}
          </p>
          {!real ? (
            <EmptyState title="Sin consumo de IA real en el período">{sim ? "Solo hubo análisis con el proveedor simulado." : "Aún no hay análisis registrados."}</EmptyState>
          ) : (
            <div className={s.summaryGrid}>
              <MiniTable
                title="Por etapa del agente"
                cols={["Etapa", "Llamadas", "Reintentos", "Coste USD", "Medio/análisis"]}
                rows={d.byStage.map((r) => [STAGE_LABEL[r.stage] ?? r.stage, r.calls, r.retryCalls, usd(r.estimatedCostUsd), usd(r.averagePerAnalysisUsd)])}
              />
              <MiniTable
                title="Por modelo y resultado"
                cols={["Modelo", "Estado", "Llamadas", "Coste USD"]}
                rows={d.byModel.filter((r) => !r.isSimulated).map((r) => [r.model, r.status, r.calls, usd(r.estimatedCostUsd)])}
              />
              <MiniTable title="Por día" cols={["Día", "Llamadas", "Coste USD"]} rows={d.byDay.map((r) => [formatDate(r.day), r.calls, usd(r.estimatedCostUsd)])} />
              <MiniTable
                title="Facturas con mayor coste"
                cols={["Factura", "Análisis", "Llamadas", "Coste USD"]}
                rows={d.byInvoice.map((r) => [
                  <Link key={r.invoiceId} to={`/invoices/${r.invoiceId}/investigation`}>
                    {r.supplierInvoiceNumber ?? shortId(r.invoiceId)}
                  </Link>,
                  r.analyses,
                  r.calls,
                  usd(r.estimatedCostUsd),
                ])}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Kpi({ label, value, strong }) {
  return (
    <div className={s.kpi}>
      <span>{label}</span>
      <strong data-strong={strong || undefined}>{value}</strong>
    </div>
  );
}

function MiniTable({ title, cols, rows }) {
  return (
    <div>
      <h3 className={s.h3}>{title}</h3>
      {rows.length === 0 ? (
        <p className="muted">Sin datos.</p>
      ) : (
        <div className="ledger-wrap">
          <table className="ledger">
            <thead>
              <tr>
                {cols.map((c, i) => (
                  <th key={c} className={i === 0 ? undefined : "num"}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {r.map((v, j) => (
                    <td key={j} className={j === 0 ? undefined : "num"}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
