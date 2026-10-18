import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { BUSINESS_STATUS, StatusBadge } from "../../../components/StatusBadge.jsx";
import { Money } from "../../../components/Money.jsx";
import { VendorStatusBadge } from "../../../components/VendorStatus.jsx";
import { Button, ButtonLink, ErrorPanel, KeyValue, Notice } from "../../../components/ui.jsx";
import { IconArrowRight, IconEdit, IconFlask, IconHourglass, IconRefresh, IconShield } from "../../../components/icons.jsx";
import { api } from "../../../lib/api.js";
import { usePrefersReducedMotion, useResource } from "../../../lib/hooks.js";
import { formatDate, formatDateTime, formatDecimal, formatPeriod } from "../../../lib/format.js";
import { RunProgress } from "./RunProgress.jsx";
import { EFFECT_LABEL, evidenceFieldOfRule, ruleLabel } from "./rules.js";
import styles from "./Detail.module.css";

const EFFECT_ORDER = { ERROR: 0, BLOCK: 1, CORRECTION: 2, ENABLEMENT: 3, APPROVAL: 4, INFO: 9 };

export function useStartAnalysis(c) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const start = async (justification) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api(`/api/invoices/${c.id}/analysis`, { method: "POST", body: justification ? { justification } : {} });
      navigate(`/invoices/${c.id}?run=${r.runId}`, { replace: true });
      c.reloadAll();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return { start, busy, error };
}

export default function Summary({ c }) {
  const { currentVersion: v, decisionRun: run, status, processing } = c;
  const analysis = useStartAnalysis(c);
  const panelRef = useRef(null);
  const reduced = usePrefersReducedMotion();
  const approvals = useResource(status === "EN_APROBACION" ? `/api/invoices/${c.id}/approval-requests` : null);

  // Una decisión recién llegada (fin de un polling real) se destaca UNA vez.
  useGSAP(
    () => {
      if (reduced || !c.poll.done || !panelRef.current) return;
      gsap.fromTo(panelRef.current, { boxShadow: "0 0 0 3px rgba(13,104,113,0.35)" }, { boxShadow: "0 0 0 0px rgba(13,104,113,0)", duration: 0.5, ease: "power2.out" });
    },
    { dependencies: [c.poll.done, run?.id] },
  );

  const issues = (run?.checks ?? []).filter((k) => k.outcome !== "PASS").sort((a, b) => (EFFECT_ORDER[a.effect] ?? 5) - (EFFECT_ORDER[b.effect] ?? 5) || a.seq - b.seq);
  const main = run ? (run.checks.find((k) => k.ruleCode === run.reasonCode && k.outcome !== "PASS") ?? issues[0]) : null;
  const fx = run?.checks.find((k) => k.ruleCode === "FX_RATE");
  const unverifiable = run?.checks.some((k) => k.ruleCode.startsWith("EVIDENCE_") && k.outcome === "UNKNOWN");
  const s = BUSINESS_STATUS[status];

  return (
    <div className={styles.summaryGrid}>
      <div className={styles.mainCol}>
        {processing && (
          <section className={styles.panel} aria-labelledby="prog-h">
            <h2 id="prog-h" className={styles.panelTitle}>
              Análisis en curso
            </h2>
            <RunProgress run={c.poll.data} stale={c.poll.stale} />
            {c.poll.error && !c.poll.stale && <ErrorPanel error={c.poll.error} title="No se pudo consultar el progreso" />}
            <p className={styles.fine}>
              <IconFlask size={14} /> La extracción usa la IA simulada (FAKE · MOCK) de este entorno. La decisión final es del motor determinista.
            </p>
          </section>
        )}

        {!run && !processing && (
          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Sin evaluar</h2>
            <p className="muted">Esta factura aún no tiene una decisión del motor.</p>
            {analysis.error && <ErrorPanel error={analysis.error} title="No se pudo iniciar el análisis" />}
            <div className={styles.actions}>
              <Button onClick={() => analysis.start()} loading={analysis.busy} icon={IconRefresh}>
                Iniciar análisis
              </Button>
            </div>
          </section>
        )}

        {run && (
          <section className={`${styles.panel} ${styles.decision}`} data-tone={s?.tone} ref={panelRef} aria-labelledby="dec-h">
            <div className={styles.decisionHead}>
              <div>
                <p className="eyebrow">Decisión del motor · corrida {run.runNo}</p>
                <h2 id="dec-h" className={styles.decisionTitle}>
                  {s?.label ?? status}
                </h2>
              </div>
              <StatusBadge status={status} size="lg" />
            </div>
            <p className={styles.decisionExplain}>{s?.explain}</p>
            {main && (
              <div className={styles.mainReason}>
                <span className="eyebrow">Motivo principal · {ruleLabel(main.ruleCode)}</span>
                <p>{main.reason}</p>
                <CheckValues k={main} />
              </div>
            )}
            {status === "AUTORIZADA" && <p className={styles.mainReason}>Todas las verificaciones obligatorias se superaron y se reservó el presupuesto (simulado).</p>}

            {issues.length > (main ? 1 : 0) && (
              <details className={styles.moreIssues}>
                <summary>
                  {issues.length} {issues.length === 1 ? "verificación no superada" : "verificaciones no superadas"}
                </summary>
                <ul>
                  {issues.map((k) => (
                    <li key={k.id}>
                      <span className={styles.effect} data-effect={k.effect}>
                        {EFFECT_LABEL[k.effect]}
                      </span>
                      <strong>{ruleLabel(k.ruleCode)}</strong> — {k.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <NextAction c={c} status={status} unverifiable={unverifiable} analysis={analysis} approvals={approvals} main={main} />
            <p className={styles.meta}>
              Evaluada {formatDateTime(run.evaluatedAt)} · {run.engineVersion} · modalidad detectada {run.detectedBillingType ?? "—"}
            </p>
          </section>
        )}

        {v && (
          <section className={styles.panel} aria-labelledby="data-h">
            <div className={styles.panelHeadRow}>
              <h2 id="data-h" className={styles.panelTitle}>
                Datos de la factura · versión {v.versionNo}
              </h2>
              <Link to={`/invoices/${c.id}/evidence`} className={styles.link}>
                Ver evidencia <IconArrowRight size={14} />
              </Link>
            </div>
            <p className={styles.fine}>
              Origen: {v.origin === "EXTRACTION" ? "extracción asistida por IA (cada dato se coteja con el documento antes de decidir)" : v.origin === "UPLOAD" ? "carga inicial (pendiente de extracción)" : "corrección manual"}
            </p>
            <KeyValue
              columns={3}
              items={[
                ["Número", v.supplierInvoiceNumber],
                ["Emisión", formatDate(v.issueDate)],
                ["Vencimiento", v.dueDate ? formatDate(v.dueDate) : null],
                ["Período de servicio", v.servicePeriodStart ? `${formatDate(v.servicePeriodStart)} – ${v.servicePeriodEnd ? formatDate(v.servicePeriodEnd) : "sin fin declarado"}` : null],
                ["Moneda", v.originalCurrency],
                ["Contrato citado", v.contractRefCited],
                ["Subtotal", v.subtotal && <Money value={v.subtotal} currency={v.originalCurrency} />],
                ["Impuestos", v.taxes && <Money value={v.taxes} currency={v.originalCurrency} />],
                ["Total", v.totalAmount && <Money value={v.totalAmount} currency={v.originalCurrency} strong />],
                ["Destino de pago (según documento)", v.paymentDestinationRaw],
              ]}
            />
            {v.lines.length > 0 && (
              <div className="ledger-wrap" style={{ marginTop: 16 }}>
                <table className="ledger stack">
                  <caption className="visually-hidden">Líneas de la factura</caption>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Concepto</th>
                      <th className="num">Cantidad</th>
                      <th className="num">Precio unitario</th>
                      <th className="num">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.lines.map((l) => (
                      <tr key={l.id}>
                        <td className="muted">{l.lineNo}</td>
                        <td>
                          {l.concept}
                          {l.itemRef && <span className="sub mono">{l.itemRef}</span>}
                        </td>
                        <td className="num" data-label="Cantidad">
                          {l.quantity ? `${formatDecimal(l.quantity, { minFraction: 0 })} ${l.unit ?? ""}` : "—"}
                        </td>
                        <td className="num" data-label="Precio">
                          {l.unitPrice ? <Money value={l.unitPrice} currency={v.originalCurrency} /> : "—"}
                        </td>
                        <td className="num">
                          <Money value={l.subtotal} currency={v.originalCurrency} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>

      <aside className={styles.sideCol}>
        <section className={styles.panel} aria-labelledby="amt-h">
          <h2 id="amt-h" className={styles.panelTitle}>
            Importe y tipo de cambio
          </h2>
          <KeyValue
            columns={1}
            items={[
              ["Moneda original", v?.totalAmount ? <Money value={v.totalAmount} currency={v.originalCurrency} strong /> : null],
              ["Equivalente en moneda base", run?.amountBase ? <Money value={run.amountBase} currency={run.baseCurrency} strong /> : null],
              ["Tasa aplicada", fx?.observedText ? <span className="mono">{fx.observedText}</span> : null],
            ]}
          />
          {fx && <p className={styles.fine}>{fx.reason}</p>}
        </section>

        {c.reservation && (
          <section className={styles.panel} aria-labelledby="res-h">
            <h2 id="res-h" className={styles.panelTitle}>
              <IconShield size={16} /> Reserva presupuestaria (simulada)
            </h2>
            <KeyValue
              columns={1}
              items={[
                ["Período", formatPeriod(c.reservation.periodYyyyMm)],
                ["Reservado", <Money key="r" value={c.reservation.reservedAmountBase} currency={c.reservation.baseCurrency} strong />],
                ...c.reservation.allocations.map((a) => [a.scope === "GLOBAL" ? "Asignación global" : "Asignación de categoría", <Money key={a.id} value={a.amountBase} currency={c.reservation.baseCurrency} />]),
                ["Autorizada", formatDateTime(c.reservation.authorizedAt)],
              ]}
            />
            <Link to="/budgets" className={styles.link}>
              Ver presupuesto del período <IconArrowRight size={14} />
            </Link>
          </section>
        )}

        <section className={styles.panel} aria-labelledby="ven-h">
          <h2 id="ven-h" className={styles.panelTitle}>
            Proveedor
          </h2>
          {c.vendor ? (
            <>
              <p className={styles.vendorName}>
                <Link to={`/vendors/${c.vendor.id}`}>{c.vendor.legalName}</Link>
              </p>
              <p className="muted">NIT {c.vendor.taxReference ?? "—"}</p>
              <p style={{ marginTop: 8 }}>
                <VendorStatusBadge status={c.vendor.status} />
              </p>
              {c.bankAccounts && (
                <p className={styles.fine}>
                  Cuentas registradas: {c.bankAccounts.length ? c.bankAccounts.map((a) => `${a.accountMask} (${a.currency}, ${a.status === "AUTHORIZED" ? "habilitada" : a.status === "BLOCKED" ? "bloqueada" : "pendiente"})`).join(", ") : "ninguna"}
                </p>
              )}
            </>
          ) : (
            <p className="muted">Cargando…</p>
          )}
        </section>
      </aside>
    </div>
  );
}

function CheckValues({ k }) {
  if (!k.observedAmount && !k.expectedAmount && !k.observedText && !k.expectedText) return null;
  return (
    <dl className={styles.obsExp}>
      {(k.observedAmount || k.observedText) && (
        <div>
          <dt>Observado</dt>
          <dd>{k.observedAmount ? <Money value={k.observedAmount} currency={k.currency} /> : <span className="mono">{k.observedText}</span>}</dd>
        </div>
      )}
      {(k.expectedAmount || k.expectedText) && (
        <div>
          <dt>Esperado / referencia</dt>
          <dd>{k.expectedAmount ? <Money value={k.expectedAmount} currency={k.currency} /> : k.expectedText}</dd>
        </div>
      )}
    </dl>
  );
}

/** Acción siguiente según el estado de negocio. Nunca "aprobar de todos modos" una discrepancia. */
function NextAction({ c, status, unverifiable, analysis, approvals, main }) {
  if (c.processing) return null;
  const base = `/invoices/${c.id}`;
  if (status === "EN_APROBACION") {
    const pending = (approvals.data?.approvalRequests ?? []).filter((a) => a.status === "PENDING");
    return (
      <div className={styles.next}>
        {pending.length > 0 ? (
          <>
            <p>
              <IconHourglass size={16} /> Pendiente de <strong>{pending[0].persona.displayName}</strong> ({pending[0].persona.designation}). Aprobador simulado.
            </p>
            <ButtonLink to={`/approvals?focus=${pending[0].id}`} icon={IconArrowRight}>
              Ir a la aprobación
            </ButtonLink>
          </>
        ) : (
          <p className="muted">{main?.effect === "ENABLEMENT" ? "Requiere habilitar el proveedor o su cuenta en Gestión → Proveedores; después, reanaliza la factura." : "No hay solicitudes de aprobación pendientes para esta factura."}</p>
        )}
        {main?.effect === "ENABLEMENT" && c.vendor && (
          <ButtonLink to={`/vendors/${c.vendor.id}`} variant="secondary">
            Revisar proveedor
          </ButtonLink>
        )}
      </div>
    );
  }
  if (status === "EN_CORRECCION") {
    const evidenceField = evidenceFieldOfRule(main?.ruleCode);
    return (
      <div className={styles.next}>
        <p>Corrige los datos aportando un documento que los respalde, o confirma manualmente campos de un documento sin texto. Una discrepancia no se aprueba.</p>
        <div className={styles.actions}>
          {unverifiable ? (
            <ButtonLink to={`${base}/evidence`} icon={IconEdit}>
              Revisar y confirmar campos
            </ButtonLink>
          ) : (
            <ButtonLink to={`${base}/correct`} icon={IconEdit}>
              Corregir versión
            </ButtonLink>
          )}
          {evidenceField && (
            <ButtonLink to={`${base}/evidence?field=${encodeURIComponent(evidenceField)}`} variant="secondary">
              Ver evidencia del campo
            </ButtonLink>
          )}
        </div>
      </div>
    );
  }
  if (status === "ERROR") {
    return (
      <div className={styles.next}>
        <p>Falla técnica sin decisión financiera. El reintento es seguro: la extracción válida previa se reutiliza.</p>
        {analysis.error && <ErrorPanel error={analysis.error} title="No se pudo reintentar" />}
        <Button onClick={() => analysis.start("Reintento manual tras error técnico")} loading={analysis.busy} icon={IconRefresh}>
          Reintentar análisis
        </Button>
      </div>
    );
  }
  if (status === "BLOQUEADA") {
    return (
      <div className={styles.next}>
        <Notice tone="danger" title="Bloqueo por política">
          Un bloqueo no se anula con una aprobación. Si los datos eran incorrectos, corrige la versión con el documento que los respalde; si la causa es la regla, debe cambiar la política o el maestro correspondiente.
        </Notice>
        <div className={styles.actions}>
          <ButtonLink to={`${base}/correct`} variant="secondary" icon={IconEdit}>
            Corregir versión
          </ButtonLink>
          <ButtonLink to={`${base}/investigation`} variant="ghost">
            Ver investigación
          </ButtonLink>
        </div>
      </div>
    );
  }
  return null;
}
