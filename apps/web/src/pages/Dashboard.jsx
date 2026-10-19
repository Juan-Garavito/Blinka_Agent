import { Link } from "react-router";
import { BUSINESS_STATUS, StatusBadge } from "../components/StatusBadge.jsx";
import { Money } from "../components/Money.jsx";
import { ButtonLink, EmptyState, ErrorPanel, Notice, PageHeader, Skeleton } from "../components/ui.jsx";
import { IconArrowRight, IconCpu, IconFlask, IconPlus } from "../components/icons.jsx";
import { useAutoRefresh, useResource } from "../lib/hooks.js";
import { formatDecimal, formatPeriod, formatRelative, ratioPermille } from "../lib/format.js";
import { useSession } from "../lib/session.jsx";
import styles from "./Dashboard.module.css";

/** Prioridad de atención: aprobación humana > errores técnicos > correcciones. */
const ATTENTION = [
  { status: "EN_APROBACION", action: "Resolver aprobación" },
  { status: "ERROR", action: "Revisar y reintentar" },
  { status: "EN_CORRECCION", action: "Corregir datos o evidencia" },
];

export default function Dashboard() {
  const { company } = useSession();
  const dash = useResource("/api/dashboard");
  const recent = useResource("/api/invoices?limit=6&sort=created_desc");
  const running = useResource("/api/invoices?status=PROCESSING&limit=5");
  const approval = useResource("/api/invoices?status=EN_APROBACION&limit=5");
  const errors = useResource("/api/invoices?status=ERROR&limit=5");
  const correction = useResource("/api/invoices?status=EN_CORRECCION&limit=4");
  const approvals = useResource("/api/approval-requests?status=PENDING");
  const categories = useResource("/api/categories");

  const d = dash.data;
  const processing = (d?.processingRuns ?? 0) > 0;
  // Recarga solo mientras hay análisis REALES en curso (sin animación de contadores inventados).
  useAutoRefresh(dash.reload, processing);
  useAutoRefresh(running.reload, processing);
  useAutoRefresh(recent.reload, processing);

  const by = d?.invoicesByStatus ?? {};
  const attentionCount = (by.EN_APROBACION ?? 0) + (by.ERROR ?? 0) + (by.EN_CORRECCION ?? 0);
  const totalInvoices = Object.values(by).reduce((a, b) => a + b, 0);
  const lists = { EN_APROBACION: approval, ERROR: errors, EN_CORRECCION: correction };
  const personaByInvoice = Object.fromEntries((approvals.data?.approvalRequests ?? []).map((a) => [a.invoiceId, a.persona]));
  const catName = Object.fromEntries((categories.data?.categories ?? []).map((c) => [c.id, c.name]));
  const global = d?.budgets.find((b) => b.scope === "GLOBAL");
  const ai = d?.aiUsage ?? [];

  return (
    <>
      <PageHeader
        eyebrow={`${company?.name ?? "Empresa"} · ${d ? formatPeriod(d.period) : "…"} · moneda base ${d?.baseCurrency ?? "…"}`}
        title="Centro de operaciones"
        actions={
          <>
            <ButtonLink to="/business" variant="ghost">
              Negocio y ROI
            </ButtonLink>
            <ButtonLink to="/invoices" variant="secondary">
              Ver facturas
            </ButtonLink>
            <ButtonLink to="/invoices/new" icon={IconPlus}>
              Nueva factura
            </ButtonLink>
          </>
        }
      >
        Qué requiere atención, qué se está analizando y qué efecto hay sobre el presupuesto del mes.
      </PageHeader>

      {dash.error ? (
        <ErrorPanel error={dash.error} onRetry={dash.reload} title="No se pudieron cargar los indicadores" />
      ) : !d ? (
        <Skeleton lines={2} label="Cargando indicadores" />
      ) : (
        <section aria-label="Indicadores" className={styles.strip}>
          <Indicator label="Requieren atención" value={attentionCount} note={`${by.EN_APROBACION ?? 0} aprobación · ${by.EN_CORRECCION ?? 0} corrección · ${by.ERROR ?? 0} error`} tone={attentionCount ? "warn" : undefined} />
          <Indicator label="Autorizadas (simulado)" value={by.AUTORIZADA ?? 0} note={`de ${totalInvoices} facturas registradas`} />
          <Indicator label="Bloqueadas" value={(by.BLOQUEADA ?? 0) + (by.RECHAZADA ?? 0)} note={`${by.BLOQUEADA ?? 0} por política · ${by.RECHAZADA ?? 0} rechazadas`} />
          <Indicator label="En análisis ahora" value={d.processingRuns} note={processing ? "actualizando cada 4 s" : "sin ejecuciones activas"} live={processing} />
          {global && (
            <Indicator
              label={`Disponible · ${formatPeriod(d.period)}`}
              value={
                <>
                  {formatDecimal(global.availableBase)} <small>{d.baseCurrency}</small>
                </>
              }
              note={`reservado ${formatDecimal(global.reservedBase)} de ${formatDecimal(global.limitBase)}`}
            />
          )}
        </section>
      )}

      <div className={styles.grid}>
        <section className={styles.attention} aria-labelledby="att-h">
          <div className={styles.sectionHead}>
            <h2 id="att-h">Casos que requieren atención</h2>
            <Link to="/invoices?status=EN_APROBACION" className={styles.more}>
              Ver todos <IconArrowRight size={14} />
            </Link>
          </div>
          {ATTENTION.map(({ status, action }) => {
            const r = lists[status];
            const rows = r.data?.invoices ?? [];
            const total = r.data?.total ?? 0;
            if (r.error) return <ErrorPanel key={status} error={r.error} onRetry={r.reload} title={`No se pudieron cargar: ${BUSINESS_STATUS[status].label}`} />;
            if (r.loading && !r.data) return <Skeleton key={status} lines={2} />;
            if (!rows.length) return null;
            return (
              <div key={status} className={styles.group}>
                <h3 className={styles.groupHead}>
                  <StatusBadge status={status} size="sm" />
                  <span className="muted">
                    {total} {total === 1 ? "caso" : "casos"} · {action}
                  </span>
                  {total > rows.length && (
                    <Link to={`/invoices?status=${status}`} className={styles.more}>
                      +{total - rows.length}
                    </Link>
                  )}
                </h3>
                <ul className={styles.caseList}>
                  {rows.map((inv) => (
                    <li key={inv.id}>
                      <Link to={`/invoices/${inv.id}`} className={styles.case}>
                        <span className={styles.caseMain}>
                          <strong>{inv.supplierInvoiceNumber ?? "Sin número extraído"}</strong>
                          <span className="muted">{inv.vendorName}</span>
                        </span>
                        <span className={styles.caseMeta}>
                          {status === "EN_APROBACION" && personaByInvoice[inv.id] && <span className="muted">{personaByInvoice[inv.id].displayName}</span>}
                          <Money value={inv.totalAmount} currency={inv.currency} />
                        </span>
                        <IconArrowRight size={16} className={styles.chev} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {d && attentionCount === 0 && ATTENTION.every(({ status }) => lists[status].data) && (
            <EmptyState title="Sin casos pendientes">No hay aprobaciones, correcciones ni errores técnicos abiertos.</EmptyState>
          )}
        </section>

        <aside className={styles.side}>
          <section aria-labelledby="run-h" className={styles.panel}>
            <div className={styles.sectionHead}>
              <h2 id="run-h">
                <IconCpu size={16} /> Análisis en curso
              </h2>
            </div>
            {running.error ? (
              <ErrorPanel error={running.error} onRetry={running.reload} />
            ) : (running.data?.invoices ?? []).length ? (
              <ul className={styles.runList}>
                {running.data.invoices.map((inv) => (
                  <li key={inv.id}>
                    <Link to={`/invoices/${inv.id}`}>
                      <span className={styles.pulse} aria-hidden />
                      <span>{inv.supplierInvoiceNumber ?? "Documento en extracción"}</span>
                      <span className="muted">{inv.vendorName}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">{running.data ? "No hay análisis ejecutándose. Al cargar una factura, su progreso real aparecerá aquí." : "Cargando…"}</p>
            )}
          </section>

          <section aria-labelledby="bud-h" className={styles.panel}>
            <div className={styles.sectionHead}>
              <h2 id="bud-h">Presupuesto {d ? formatPeriod(d.period) : ""}</h2>
              <Link to="/budgets" className={styles.more}>
                Detalle <IconArrowRight size={14} />
              </Link>
            </div>
            {!d ? (
              <Skeleton lines={3} />
            ) : d.budgets.length === 0 ? (
              <p className="muted">No hay presupuestos definidos para este período. Sin presupuesto, el motor no puede autorizar.</p>
            ) : (
              <ul className={styles.budgets}>
                {[...d.budgets]
                  .sort((a, b) => (a.scope === "GLOBAL" ? -1 : b.scope === "GLOBAL" ? 1 : 0))
                  .map((b) => {
                    const pm = ratioPermille(b.reservedBase, b.limitBase);
                    return (
                      <li key={b.id}>
                        <div className={styles.budgetRow}>
                          <span>{b.scope === "GLOBAL" ? "Global" : (catName[b.categoryId] ?? "Categoría")}</span>
                          <span className="num">
                            {formatDecimal(b.availableBase)} <span className="muted">{d.baseCurrency} disp.</span>
                          </span>
                        </div>
                        <div className={styles.bar} role="img" aria-label={`Reservado ${Math.round(pm / 10)} % del límite`}>
                          <span style={{ width: `${pm / 10}%` }} data-high={pm >= 800 || undefined} />
                        </div>
                        <p className={styles.budgetNote}>
                          Reservado (simulado) {formatDecimal(b.reservedBase)} de {formatDecimal(b.limitBase)} {d.baseCurrency}
                        </p>
                      </li>
                    );
                  })}
              </ul>
            )}
          </section>

          {ai.length > 0 && (
            <section aria-labelledby="ai-h" className={styles.panel}>
              <div className={styles.sectionHead}>
                <h2 id="ai-h">Uso de IA</h2>
                <Link to="/audit/ai-usage" className={styles.more}>
                  Registro <IconArrowRight size={14} />
                </Link>
              </div>
              {ai.map((u) => (
                <div key={u.provider} className={styles.aiRow}>
                  <span>
                    {u.isSimulated && <IconFlask size={14} />} {u.provider}
                  </span>
                  <span className="num muted">
                    {u.calls} llamadas · {u.inputTokens + u.outputTokens} tokens
                    {!u.isSimulated && <> · ≈ {formatDecimal(u.estimatedCostUsd, { minFraction: 2, maxFraction: 6 })} USD</>}
                  </span>
                </div>
              ))}
              {ai.every((u) => u.isSimulated) ? (
                <p className={styles.budgetNote}>Proveedor simulado: tokens estimados y costo 0. No se usó un modelo real.</p>
              ) : (
                <p className={styles.budgetNote}>Coste estimado con el precio de lista configurado (incluye pensamiento). No es la factura del proveedor.</p>
              )}
            </section>
          )}
        </aside>
      </div>

      <section aria-labelledby="rec-h" className={styles.recent}>
        <div className={styles.sectionHead}>
          <h2 id="rec-h">Actividad reciente</h2>
          <Link to="/invoices" className={styles.more}>
            Todas las facturas <IconArrowRight size={14} />
          </Link>
        </div>
        {recent.error ? (
          <ErrorPanel error={recent.error} onRetry={recent.reload} />
        ) : !recent.data ? (
          <Skeleton lines={4} />
        ) : recent.data.invoices.length === 0 ? (
          <EmptyState title="Aún no hay facturas" action={<ButtonLink to="/invoices/new" icon={IconPlus}>Cargar la primera factura</ButtonLink>}>
            Carga una factura con su proveedor para iniciar un análisis.
          </EmptyState>
        ) : (
          <div className="ledger-wrap">
            <table className="ledger stack">
              <caption className="visually-hidden">Últimas facturas registradas</caption>
              <thead>
                <tr>
                  <th>Factura</th>
                  <th>Estado</th>
                  <th className="num">Importe</th>
                  <th className="hide-sm">Registrada</th>
                </tr>
              </thead>
              <tbody>
                {recent.data.invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="primary-cell">
                      <Link to={`/invoices/${inv.id}`}>{inv.supplierInvoiceNumber ?? "Sin número extraído"}</Link>
                      <span className="sub">{inv.vendorName}</span>
                    </td>
                    <td>
                      <StatusBadge status={inv.status} processing={inv.processing} size="sm" />
                    </td>
                    <td className="num">
                      <Money value={inv.totalAmount} currency={inv.currency} />
                    </td>
                    <td className="hide-sm muted">{formatRelative(inv.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {d?.simulatedAuthorizations && (
        <div className={styles.footNotice}>
          <Notice tone="demo" icon={IconFlask}>
            Las autorizaciones y reservas presupuestarias son <strong>simuladas</strong>: ninguna acción de esta aplicación ejecuta pagos.
          </Notice>
        </div>
      )}
    </>
  );
}

function Indicator({ label, value, note, tone, live }) {
  return (
    <div className={styles.indicator} data-tone={tone} aria-live={live ? "polite" : undefined}>
      <span className={styles.indLabel}>{label}</span>
      <span className={styles.indValue}>{value}</span>
      {note && <span className={styles.indNote}>{note}</span>}
    </div>
  );
}
