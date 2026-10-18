import { Link } from "react-router";
import { Money } from "../../../components/Money.jsx";
import { BILLING_TYPE } from "../../../components/VendorStatus.jsx";
import { EmptyState, ErrorPanel, Skeleton } from "../../../components/ui.jsx";
import { IconAlert, IconCheckCircle, IconClock, IconFlask } from "../../../components/icons.jsx";
import { usePolling, useResource } from "../../../lib/hooks.js";
import { formatDateTime } from "../../../lib/format.js";
import { RunProgress } from "./RunProgress.jsx";
import { EFFECT_LABEL, RULE_GROUPS, ruleLabel } from "./rules.js";
import styles from "./Detail.module.css";

const OUTCOME = {
  PASS: { label: "Superada", Icon: IconCheckCircle },
  FAIL: { label: "No superada", Icon: IconAlert },
  UNKNOWN: { label: "Sin poder verificar", Icon: IconClock },
};

/** Investigación: etapas del agente, candidatos de contrato, verificaciones del motor y políticas aplicadas. */
export default function Investigation({ c }) {
  const run = c.decisionRun;
  const stages = usePolling(run ? `/api/evaluation-runs/${run.id}` : null, { isDone: () => true });
  const ev = useResource(run ? `/api/evaluation-runs/${run.id}/evidence` : null);
  const usage = useResource(run ? `/api/ai-usage?evaluationRunId=${run.id}` : null);

  if (c.evals.error) return <ErrorPanel error={c.evals.error} onRetry={c.evals.reload} />;
  if (!c.evals.data) return <Skeleton lines={6} />;
  if (!run) return <EmptyState title="Aún no hay una corrida completada">{c.processing ? "El análisis está en curso; la investigación aparecerá al terminar." : "Inicia el análisis desde el resumen."}</EmptyState>;

  const groups = RULE_GROUPS.map((g) => ({ ...g, checks: [] }));
  for (const k of run.checks) groups.find((g) => g.test(k.ruleCode)).checks.push(k);

  return (
    <div className={styles.investigation}>
      <div className={styles.invTop}>
        <section className={styles.panel} aria-labelledby="st-h">
          <h2 id="st-h" className={styles.panelTitle}>
            Etapas del agente · corrida {run.runNo}
          </h2>
          {stages.data ? <RunProgress run={stages.data} compact /> : stages.error ? <ErrorPanel error={stages.error} /> : <Skeleton lines={4} />}
          <p className={styles.fine}>Iniciada {formatDateTime(run.startedAt)} · decidida {formatDateTime(run.evaluatedAt)} · {run.flow.triggerType === "UPLOAD" ? "por carga" : `disparada por ${run.flow.triggerType.toLowerCase()}`}</p>
        </section>

        <section className={styles.panel} aria-labelledby="cand-h">
          <h2 id="cand-h" className={styles.panelTitle}>
            Contratos candidatos
          </h2>
          {ev.error ? (
            <ErrorPanel error={ev.error} />
          ) : !ev.data ? (
            <Skeleton lines={3} />
          ) : ev.data.candidates.length === 0 ? (
            <p className="muted">No se encontró ningún contrato vigente del proveedor.</p>
          ) : (
            <ul className={styles.candidates}>
              {ev.data.candidates.map((k) => (
                <li key={k.id} data-selected={k.selected || undefined}>
                  <div>
                    <Link to={`/contracts/${k.contractId}`}>{k.contractRef}</Link> <span className="muted">v{k.versionNo} · {BILLING_TYPE[k.billingType] ?? k.billingType}</span>
                  </div>
                  <span className={styles.fine}>
                    {k.selected ? "Seleccionado" : "Descartado"} — {k.reason}
                    {k.typeMatch === false && " · modalidad distinta"}
                    {k.referenceMatch === true && " · referencia citada coincide"}
                    {k.referenceMatch === false && " · referencia citada no coincide"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.panel} aria-labelledby="ai-h">
          <h2 id="ai-h" className={styles.panelTitle}>
            Uso de IA en esta corrida
          </h2>
          {!usage.data ? (
            <Skeleton lines={2} />
          ) : usage.data.usage.length === 0 ? (
            <p className="muted">Sin llamadas al modelo (extracción reutilizada o sin IA).</p>
          ) : (
            <ul className={styles.plain}>
              {usage.data.usage.map((u) => (
                <li key={u.id}>
                  {u.isSimulated && <IconFlask size={14} />} <strong>{u.provider}</strong> · {u.model} · {u.taskType} · {u.inputTokens + u.outputTokens} tokens · {u.status}
                </li>
              ))}
            </ul>
          )}
          {usage.data?.usage.some((u) => u.isSimulated) && <p className={styles.fine}>Proveedor simulado: la salida es determinista de prueba, no un modelo real.</p>}
        </section>
      </div>

      {groups
        .filter((g) => g.checks.length)
        .map((g) => {
          const bad = g.checks.filter((k) => k.outcome !== "PASS").length;
          return (
            <section key={g.id} className={styles.checkGroup} aria-labelledby={`g-${g.id}`}>
              <h2 id={`g-${g.id}`}>
                {g.title} <span className="muted">· {g.checks.length - bad}/{g.checks.length} superadas</span>
              </h2>
              <ul className={styles.checks}>
                {g.checks.map((k) => {
                  const o = OUTCOME[k.outcome];
                  return (
                    <li key={k.id} data-outcome={k.outcome} data-effect={k.effect}>
                      <span className={styles.checkIcon} aria-hidden>
                        <o.Icon size={16} />
                      </span>
                      <div className={styles.checkBody}>
                        <p>
                          <strong>{ruleLabel(k.ruleCode)}</strong> <span className="visually-hidden">: {o.label}.</span>
                          {k.effect !== "INFO" && (
                            <span className={styles.effect} data-effect={k.effect}>
                              {EFFECT_LABEL[k.effect]}
                            </span>
                          )}
                        </p>
                        <p className="muted">{k.reason}</p>
                        {(k.observedAmount || k.expectedAmount) && (
                          <p className={styles.fine}>
                            {k.observedAmount && (
                              <>
                                Observado <Money value={k.observedAmount} currency={k.currency} />
                              </>
                            )}
                            {k.expectedAmount && (
                              <>
                                {" "}
                                · límite/esperado <Money value={k.expectedAmount} currency={k.currency} />
                              </>
                            )}
                          </p>
                        )}
                      </div>
                      <code className={styles.ruleCode}>{k.ruleCode}</code>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}

      {run.appliedPolicies?.length > 0 && (
        <section className={styles.checkGroup} aria-labelledby="pol-h">
          <h2 id="pol-h">Políticas aplicadas</h2>
          <ul className={styles.plain}>
            {run.appliedPolicies.map((p) => (
              <li key={p.policyVersionId}>
                <Link to="/policies">{p.applicabilityReason}</Link> <span className="mono muted">v {p.policyVersionId.slice(0, 8)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
