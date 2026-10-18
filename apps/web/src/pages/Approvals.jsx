import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { StatusBadge } from "../components/StatusBadge.jsx";
import { Money } from "../components/Money.jsx";
import { Button, ConfirmDialog, EmptyState, ErrorPanel, Field, Notice, PageHeader, Skeleton, useToast } from "../components/ui.jsx";
import { IconArrowRight, IconFlask, IconUser } from "../components/icons.jsx";
import { api } from "../lib/api.js";
import { useResource } from "../lib/hooks.js";
import { formatDateTime, formatRelative } from "../lib/format.js";
import { useSession } from "../lib/session.jsx";
import { EFFECT_LABEL, ruleLabel } from "./invoices/detail/rules.js";
import styles from "./Approvals.module.css";

const FILTERS = [
  ["PENDING", "Pendientes"],
  ["APPROVED", "Aprobadas"],
  ["REJECTED", "Rechazadas"],
  ["SUPERSEDED", "Sustituidas"],
];
const STATUS_LABEL = { PENDING: "Pendiente", APPROVED: "Aprobada (simulada)", REJECTED: "Rechazada (simulada)", SUPERSEDED: "Sustituida" };

/** Aprobaciones SIMULADAS: el evaluador registra la decisión de una persona aprobadora ficticia; APROBAR reevalúa. */
export default function Approvals() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "PENDING";
  const focus = params.get("focus");
  const list = useResource(`/api/approval-requests?status=${status}`);


  return (
    <>
      <PageHeader eyebrow="Operaciones" title="Aprobaciones">
        Facturas que el motor envió a aprobación humana. Las personas aprobadoras son <strong>simuladas</strong>; aprobar dispara una nueva evaluación determinista (FX, contrato, política y presupuesto se revalidan).
      </PageHeader>
      <nav className={styles.filters} aria-label="Filtrar por estado">
        {FILTERS.map(([k, l]) => (
          <button key={k} type="button" aria-pressed={status === k} onClick={() => setParams(k === "PENDING" ? {} : { status: k })}>
            {l}
          </button>
        ))}
      </nav>
      {list.error ? (
        <ErrorPanel error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Skeleton lines={6} />
      ) : list.data.approvalRequests.length === 0 ? (
        <EmptyState title={status === "PENDING" ? "No hay aprobaciones pendientes" : "Sin solicitudes en este estado"}>
          {status === "PENDING" ? "Cuando una factura supere el límite de autorización automática, aparecerá aquí." : null}
        </EmptyState>
      ) : (
        <ul className={styles.list}>
          {list.data.approvalRequests.map((r) => (
            <ApprovalCard key={r.id} r={r} inv={r} initiallyOpen={focus === r.id || list.data.approvalRequests.length === 1} onResolved={list.reload} />
          ))}
        </ul>
      )}
    </>
  );
}

function ApprovalCard({ r, inv, initiallyOpen, onResolved }) {
  const [open, setOpen] = useState(initiallyOpen && r.status === "PENDING");
  const evals = useResource(open ? `/api/invoices/${r.invoiceId}/evaluations` : null);
  const [decision, setDecision] = useState(null);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const toast = useToast();
  const base = useSession().company?.baseCurrency ?? "";

  const run = evals.data?.flows.flatMap((f) => f.runs).find((x) => x.status === "COMPLETED" && x.flowId === r.flowId && x.visibleOutcome === "EN_APROBACION");
  const why = run?.checks.filter((k) => k.outcome !== "PASS") ?? [];
  const reasonErr = reason.trim().length < 3 ? "Indica el motivo (mínimo 3 caracteres)." : null;
  const decisionErr = !decision ? "Elige aprobar o rechazar." : null;

  const resolve = async () => {
    if (busy) return; // doble envío
    setBusy(true);
    setError(null);
    try {
      const res = await api(`/api/approval-requests/${r.id}/resolve`, { method: "POST", body: { decision, reason: reason.trim() } });
      setResult(res);
      setConfirming(false);
      toast(decision === "APPROVE" ? `Aprobación registrada. Reevaluación: ${res.evaluation?.visibleOutcome ?? "—"}` : "Rechazo registrado (simulado).");
    } catch (e) {
      setError(e);
      setConfirming(false);
      if (e.code === "APPROVAL_ALREADY_RESOLVED") onResolved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={styles.card} data-open={open || undefined}>
      <div className={styles.cardHead}>
        <div className={styles.cardMain}>
          <Link to={`/invoices/${r.invoiceId}`} className={styles.invLink}>
            {inv?.supplierInvoiceNumber ?? `Factura ${r.invoiceId.slice(0, 8)}`}
          </Link>
          <span className="muted">{inv?.vendorName ?? ""}</span>
        </div>
        <div className={styles.cardAmount}>
          <Money value={r.amountBase} currency={base} strong />
          <span className="muted">importe en moneda base</span>
        </div>
        <div className={styles.persona}>
          <IconUser size={16} />
          <span>
            {r.persona.displayName}
            <span className="muted"> · {r.persona.designation}</span>
          </span>
        </div>
        <div className={styles.cardState}>
          <span className={styles.reqStatus} data-status={r.status}>
            {STATUS_LABEL[r.status]}
          </span>
          <span className="muted">{r.resolvedAt ? `resuelta ${formatDateTime(r.resolvedAt)}` : `solicitada ${formatRelative(r.requestedAt)}`}</span>
        </div>
        {r.status === "PENDING" && !result && (
          <Button variant={open ? "ghost" : "secondary"} size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "Cerrar" : "Resolver"}
          </Button>
        )}
      </div>
      {r.resolutionReason && <p className={styles.resolution}>Motivo registrado: {r.resolutionReason}</p>}

      {open && !result && (
        <div className={styles.body}>
          <section>
            <h3>Por qué requiere aprobación</h3>
            {evals.error ? (
              <ErrorPanel error={evals.error} />
            ) : !evals.data ? (
              <Skeleton lines={2} />
            ) : why.length ? (
              <ul className={styles.why}>
                {why.map((k) => (
                  <li key={k.id}>
                    <span className={styles.effect}>{EFFECT_LABEL[k.effect]}</span> <strong>{ruleLabel(k.ruleCode)}</strong> — {k.reason}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Sin detalle disponible en la corrida.</p>
            )}
          </section>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              setTouched(true);
              if (!reasonErr && !decisionErr) setConfirming(true);
            }}
          >
            <fieldset className={styles.choice}>
              <legend>Resolución de {r.persona.displayName} (simulada)</legend>
              <label data-checked={decision === "APPROVE" || undefined}>
                <input type="radio" name={`d-${r.id}`} checked={decision === "APPROVE"} onChange={() => setDecision("APPROVE")} />
                <span>
                  <strong>Aprobar</strong>
                  <span className="muted">Se reevalúa: si todo sigue conforme, queda Autorizada con reserva simulada.</span>
                </span>
              </label>
              <label data-checked={decision === "REJECT" || undefined}>
                <input type="radio" name={`d-${r.id}`} checked={decision === "REJECT"} onChange={() => setDecision("REJECT")} />
                <span>
                  <strong>Rechazar</strong>
                  <span className="muted">La factura queda Rechazada (decisión humana, distinta de un bloqueo).</span>
                </span>
              </label>
              {touched && decisionErr && <p className={styles.err}>{decisionErr}</p>}
            </fieldset>
            <Field label="Motivo" required error={touched ? reasonErr : null}>
              {(p) => <textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}
            </Field>
            {error && <ErrorPanel error={error} title={error.code === "APPROVAL_ALREADY_RESOLVED" ? "La solicitud ya fue resuelta" : "No se pudo registrar la resolución"} />}
            <div className={styles.formActions}>
              <Button type="submit" variant={decision === "REJECT" ? "danger" : "primary"}>
                Registrar resolución
              </Button>
              <p className={styles.fine}>
                <IconFlask size={14} /> Aprobador simulado: queda auditado a tu nombre como evaluador.
              </p>
            </div>
          </form>
        </div>
      )}

      {result && (
        <div className={styles.body}>
          <Notice tone={result.evaluation?.visibleOutcome === "AUTORIZADA" ? "success" : "info"} title={result.approval.status === "APPROVED" ? "Aprobación registrada y factura reevaluada" : "Rechazo registrado"}>
            <span className={styles.resultRow}>
              Resultado actual: <StatusBadge status={result.evaluation?.visibleOutcome} size="sm" />
              {result.evaluation?.reasonCode && result.evaluation.visibleOutcome !== "AUTORIZADA" && <span className="muted"> · {ruleLabel(result.evaluation.reasonCode)}</span>}
              <Link to={`/invoices/${r.invoiceId}`}>
                Ver factura <IconArrowRight size={14} />
              </Link>
            </span>
          </Notice>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title={decision === "APPROVE" ? "¿Registrar aprobación simulada?" : "¿Registrar rechazo simulado?"}
        confirmLabel={decision === "APPROVE" ? "Aprobar y reevaluar" : "Rechazar factura"}
        tone={decision === "APPROVE" ? "primary" : "danger"}
        busy={busy}
        onConfirm={resolve}
        onCancel={() => setConfirming(false)}
      >
        <p>
          {inv?.supplierInvoiceNumber ?? "Factura"} · <Money value={r.amountBase} currency={base} />. Persona aprobadora simulada: {r.persona.displayName}.
        </p>
        <p className="muted">Motivo: {reason.trim()}</p>
        <p className="muted">No se ejecuta ningún pago. La acción queda en la auditoría.</p>
      </ConfirmDialog>
    </li>
  );
}
