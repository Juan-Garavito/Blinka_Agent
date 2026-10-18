import { Link } from "react-router";
import { StatusBadge } from "../../../components/StatusBadge.jsx";
import { Money } from "../../../components/Money.jsx";
import { ErrorPanel, Skeleton } from "../../../components/ui.jsx";
import { useResource } from "../../../lib/hooks.js";
import { formatDateTime, formatDuration, shortId } from "../../../lib/format.js";
import { ruleLabel, TRIGGER_LABEL } from "./rules.js";
import styles from "./Detail.module.css";

const ORIGIN = { UPLOAD: "Carga", EXTRACTION: "Extracción IA", CORRECTION: "Corrección", MANUAL: "Manual" };
const ACTOR = { USER: "Persona", SYSTEM: "Sistema", AGENT: "Agente" };

/** Historial: versiones inmutables, flujos/corridas de evaluación y eventos de auditoría de la factura. */
export default function History({ c }) {
  const audit = useResource(`/api/audit-events?entityType=invoice&entityRef=${c.id}&limit=100`);
  const flows = [...(c.evals.data?.flows ?? [])].reverse();

  return (
    <div className={styles.history}>
      <section aria-labelledby="ver-h">
        <h2 id="ver-h" className={styles.sectionTitle}>
          Versiones ({c.versions.length})
        </h2>
        <div className="ledger-wrap">
          <table className="ledger stack">
            <thead>
              <tr>
                <th>Versión</th>
                <th>Origen</th>
                <th>Número</th>
                <th className="num">Total</th>
                <th className="hide-sm">Creada</th>
              </tr>
            </thead>
            <tbody>
              {c.versions.map((v) => (
                <tr key={v.id}>
                  <td className="primary-cell">
                    v{v.versionNo}
                    {v.id === c.invoice.currentVersionId && <span className="sub">actual</span>}
                  </td>
                  <td>{ORIGIN[v.origin] ?? v.origin}</td>
                  <td>{v.supplierInvoiceNumber ?? <span className="muted">—</span>}</td>
                  <td className="num">
                    <Money value={v.totalAmount} currency={v.originalCurrency} />
                  </td>
                  <td className="hide-sm muted">{formatDateTime(v.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="flow-h">
        <h2 id="flow-h" className={styles.sectionTitle}>
          Evaluaciones
        </h2>
        {flows.length === 0 ? (
          <p className="muted">Sin evaluaciones.</p>
        ) : (
          <ol className={styles.timeline}>
            {flows.map((f) => (
              <li key={f.id}>
                <p className={styles.tlHead}>
                  <strong>Trámite {TRIGGER_LABEL[f.triggerType] ?? f.triggerType}</strong>
                  <span className="muted"> · abierto {formatDateTime(f.openedAt)}</span>
                  {f.terminalStatus && <StatusBadge status={f.terminalStatus} size="sm" />}
                </p>
                {f.justification && <p className={styles.fine}>Justificación: {f.justification}</p>}
                <ul className={styles.runs}>
                  {f.runs.map((r) => (
                    <li key={r.id}>
                      <span>Corrida {r.runNo}</span>
                      <span className="muted">{r.status === "RUNNING" ? "en curso" : r.status === "SUPERSEDED" ? "reemplazada" : r.visibleOutcome ? `→ ${r.visibleOutcome.replace("_", " ").toLowerCase()}` : ""}</span>
                      {r.reasonCode && <span>{ruleLabel(r.reasonCode)}</span>}
                      <span className="muted">{formatDuration(r.startedAt, r.evaluatedAt) ?? ""}</span>
                      <span className="mono muted">{shortId(r.id)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="aud-h">
        <div className={styles.panelHeadRow}>
          <h2 id="aud-h" className={styles.sectionTitle}>
            Auditoría de la factura
          </h2>
          <Link to={`/audit?entityRef=${c.id}`} className={styles.link}>
            Abrir en Auditoría
          </Link>
        </div>
        {audit.error ? (
          <ErrorPanel error={audit.error} onRetry={audit.reload} />
        ) : !audit.data ? (
          <Skeleton lines={5} />
        ) : (
          <ol className={styles.auditList}>
            {audit.data.events.map((e) => (
              <li key={e.id}>
                <time className="muted">{formatDateTime(e.occurredAt)}</time>
                <span className="mono">{e.eventType}</span>
                <span>
                  {ACTOR[e.actorKind] ?? e.actorKind} <span className="muted">{e.actorKind === "USER" ? shortId(e.actorRef) : e.actorRef}</span>
                </span>
                {e.details?.reason && <span className={styles.fine}>{e.details.reason}</span>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
