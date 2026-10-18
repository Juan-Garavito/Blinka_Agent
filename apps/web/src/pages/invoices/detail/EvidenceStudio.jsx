import { useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { Button, EmptyState, ErrorPanel, Notice, Skeleton } from "../../../components/ui.jsx";
import { IconAlert, IconCheckCircle, IconClock, IconExternal, IconUser } from "../../../components/icons.jsx";
import { api } from "../../../lib/api.js";
import { usePrefersReducedMotion, useResource } from "../../../lib/hooks.js";
import { formatDecimal } from "../../../lib/format.js";
import { segmentText } from "./highlight.js";
import { fieldLabel } from "./rules.js";
import styles from "./Detail.module.css";

export const EVIDENCE_STATUS = {
  TEXT_VERIFIED: { label: "Verificado en el texto", tone: "ok", Icon: IconCheckCircle },
  HUMAN_CONFIRMED: { label: "Confirmado por una persona", tone: "human", Icon: IconUser },
  NOT_FOUND: { label: "No aparece en el documento", tone: "bad", Icon: IconAlert },
  UNVERIFIABLE: { label: "Sin texto verificable", tone: "warn", Icon: IconClock },
  MODEL_REPORTED: { label: "Citado por la IA, sin verificar", tone: "model", Icon: IconClock },
  REJECTED: { label: "Cita de la IA no encontrada", tone: "bad", Icon: IconAlert },
};

const MONEY_FIELDS = /(subtotal|taxes|discounts|totalAmount|unitPrice)$/;

/** Valor de la versión evaluada para un campo de evidencia ("lines[1].unitPrice", "paymentAccount"…). */
export function valueOf(version, field) {
  if (!version) return null;
  const m = /^lines\[(\d+)\]\.(\w+)$/.exec(field);
  if (m) return version.lines.find((l) => l.lineNo === Number(m[1]))?.[m[2]] ?? null;
  if (field === "currency") return version.originalCurrency;
  if (field === "paymentAccount") return version.paymentDestinationRaw;
  return version[field] ?? null;
}

/**
 * Evidence Studio: el documento original es protagonista; cada dato usado para decidir se resalta en
 * su posición REAL (página + caracteres) informada por el verificador del backend.
 */
export default function EvidenceStudio({ c }) {
  const run = c.decisionRun;
  const ev = useResource(run ? `/api/evaluation-runs/${run.id}/evidence` : null);
  const version = c.versions.find((v) => v.id === run?.invoiceVersionId) ?? null;
  const docId = version?.sourceDocumentId;
  const text = useResource(docId ? `/api/documents/${docId}/text` : null);
  const doc = useResource(docId ? `/api/documents/${docId}` : null);
  const [params, setParams] = useSearchParams();
  const selected = params.get("field");
  const docRef = useRef(null);
  const reduced = usePrefersReducedMotion();

  const fields = useMemo(() => {
    const rows = ev.data?.evidence ?? [];
    const by = new Map();
    for (const e of rows) {
      const f = by.get(e.sourceField) ?? { field: e.sourceField, verifier: null, model: [] };
      if (e.evaluationCheckId) f.verifier = e;
      else f.model.push(e);
      by.set(e.sourceField, f);
    }
    const order = ["supplierInvoiceNumber", "issueDate", "servicePeriodStart", "servicePeriodEnd", "currency", "subtotal", "taxes", "totalAmount", "paymentAccount", "contractRefCited"];
    const rank = (f) => (order.includes(f) ? order.indexOf(f) : f.startsWith("lines[") ? 50 + f.length : 99);
    return [...by.values()].filter((f) => f.verifier).sort((a, b) => rank(a.field) - rank(b.field) || a.field.localeCompare(b.field));
  }, [ev.data]);

  // Selección: desplaza el resaltado a la vista y lo enfatiza (M-evidencia 380 ms; sin animación si se reduce el movimiento).
  useGSAP(
    () => {
      if (!selected || !docRef.current) return;
      const marks = docRef.current.querySelectorAll(`mark[data-fields~="${CSS.escape(selected)}"]`);
      if (!marks.length) return;
      marks[0].scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
      if (!reduced) gsap.fromTo(marks, { backgroundColor: "rgba(214,163,87,0.85)" }, { backgroundColor: "rgba(214,163,87,0.32)", duration: 0.38, ease: "power2.out" });
    },
    { dependencies: [selected, text.data, reduced], scope: docRef },
  );

  if (!run) return <EmptyState title="Sin evidencia todavía">{c.processing ? "El análisis está en curso." : "La evidencia se genera al analizar la factura."}</EmptyState>;
  if (ev.error) return <ErrorPanel error={ev.error} onRetry={ev.reload} />;
  if (!ev.data || !version) return <Skeleton lines={8} label="Cargando evidencia" />;

  const layer = text.data?.layer;
  const hasText = layer?.status === "TEXT";
  const select = (f) => {
    const next = new URLSearchParams(params);
    if (f && f !== selected) next.set("field", f);
    else next.delete("field");
    setParams(next, { replace: true, preventScrollReset: true });
  };
  const counts = fields.reduce((acc, f) => ({ ...acc, [f.verifier.verificationStatus]: (acc[f.verifier.verificationStatus] ?? 0) + 1 }), {});
  const unverifiable = fields.filter((f) => f.verifier.verificationStatus === "UNVERIFIABLE");
  const isCurrent = version.id === c.invoice.currentVersionId;

  return (
    <div className={styles.studio}>
      <section className={styles.docPane} aria-label="Documento original">
        <header className={styles.docHead}>
          <div>
            <strong>{doc.data?.document.originalName ?? "Documento"}</strong>
            <span className="muted">
              {" "}
              · versión {version.versionNo} · {layer ? (hasText ? `capa de texto (${layer.pageCount} pág.)` : layer.status === "NO_TEXT" ? "sin capa de texto (imagen o escaneo)" : "texto no legible") : "…"}
            </span>
          </div>
          <a className={styles.link} href={`/api/documents/${docId}/content?disposition=inline`} target="_blank" rel="noreferrer">
            Abrir original <IconExternal size={14} />
          </a>
        </header>
        <div className={styles.docBody} ref={docRef}>
          {text.error ? (
            <ErrorPanel error={text.error} onRetry={text.reload} />
          ) : !text.data ? (
            <Skeleton lines={10} />
          ) : hasText ? (
            text.data.pages.map((p) => (
              <article key={p.pageNo} className={styles.page} aria-label={`Página ${p.pageNo}`}>
                <span className={styles.pageNo}>Pág. {p.pageNo}</span>
                <pre className={styles.pageText}>
                  {segmentText(
                    p.text,
                    fields.filter((f) => f.verifier.pageNumber === p.pageNo).map((f) => ({ id: f.field, start: f.verifier.charStart, end: f.verifier.charEnd })),
                  ).map((seg, i) =>
                    seg.ids.length ? (
                      <mark key={i} data-fields={seg.ids.join(" ")} data-active={seg.ids.includes(selected) || undefined} onClick={() => select(seg.ids[0])} title={seg.ids.map(fieldLabel).join(", ")}>
                        {seg.text}
                      </mark>
                    ) : (
                      <span key={i}>{seg.text}</span>
                    ),
                  )}
                </pre>
              </article>
            ))
          ) : doc.data?.document.mimeType?.startsWith("image/") ? (
            <img className={styles.docImage} src={`/api/documents/${docId}/content?disposition=inline`} alt={`Imagen del documento original ${doc.data.document.originalName}`} />
          ) : (
            <Notice tone="warning" icon={IconAlert} title="El documento no tiene texto verificable">
              Ábrelo con «Abrir original» para revisarlo visualmente antes de confirmar campos.
            </Notice>
          )}
        </div>
        {hasText && <p className={styles.fine}>Texto extraído del PDF original ({layer.extractor}). Los resaltados son las posiciones exactas en las que el verificador encontró cada valor.</p>}
      </section>

      <section className={styles.fieldPane} aria-labelledby="ev-h">
        <h2 id="ev-h" className={styles.panelTitle}>
          Datos usados para decidir
        </h2>
        <p className={styles.counts}>
          {Object.entries(counts).map(([k, n]) => (
            <span key={k} data-tone={EVIDENCE_STATUS[k]?.tone}>
              {n} {EVIDENCE_STATUS[k]?.label.toLowerCase() ?? k}
            </span>
          ))}
        </p>
        <ul className={styles.fieldList}>
          {fields.map((f) => {
            const st = EVIDENCE_STATUS[f.verifier.verificationStatus] ?? { label: f.verifier.verificationStatus, tone: "model", Icon: IconClock };
            const value = valueOf(version, f.field);
            const located = f.verifier.charStart != null;
            return (
              <li key={f.field} data-tone={st.tone} data-active={selected === f.field || undefined}>
                <button type="button" onClick={() => select(f.field)} aria-pressed={selected === f.field} disabled={!located && !f.model.length && f.verifier.verificationStatus !== "NOT_FOUND"}>
                  <span className={styles.fieldTop}>
                    <span className={styles.fieldName}>{fieldLabel(f.field)}</span>
                    <span className={styles.evStatus} data-tone={st.tone}>
                      <st.Icon size={13} /> {st.label}
                    </span>
                  </span>
                  <span className={styles.fieldValue}>{value == null ? <span className="muted">sin valor</span> : MONEY_FIELDS.test(f.field) ? formatDecimal(value) : /quantity$/.test(f.field) ? formatDecimal(value, { minFraction: 0 }) : String(value)}</span>
                  {f.verifier.excerpt && (
                    <span className={styles.excerpt}>
                      pág. {f.verifier.pageNumber}: «{f.verifier.excerpt}»
                    </span>
                  )}
                  {f.verifier.verificationStatus === "NOT_FOUND" && <span className={styles.excerpt}>El valor extraído no aparece en el texto del original. Corrige la versión con el documento correcto.</span>}
                  {f.model.map((m) => (
                    <span key={m.id} className={styles.modelCite}>
                      IA citó{m.pageNumber ? ` pág. ${m.pageNumber}` : ""}: «{m.excerpt}» {m.verificationStatus === "REJECTED" ? "(cita no encontrada)" : "(no usado como prueba)"}
                    </span>
                  ))}
                </button>
              </li>
            );
          })}
        </ul>

        {unverifiable.length > 0 && isCurrent && !hasText && <ConfirmFields c={c} version={version} fields={unverifiable} />}
        {unverifiable.length > 0 && !isCurrent && <Notice tone="info">Esta evidencia corresponde a una versión anterior; las confirmaciones solo se hacen sobre la versión actual.</Notice>}
      </section>
    </div>
  );
}

/** Confirmación humana auditada de campos de un documento SIN texto (imagen/escaneo). Luego se reanaliza. */
function ConfirmFields({ c, version, fields }) {
  const navigate = useNavigate();
  const [chosen, setChosen] = useState(() => new Set(fields.map((f) => f.field)));
  const [reason, setReason] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const valid = chosen.size > 0 && reason.trim().length >= 10 && reviewed;

  const submit = async (e) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/invoices/${c.id}/versions/${version.id}/confirmations`, { method: "POST", body: { fields: [...chosen], reason: reason.trim() } });
      const r = await api(`/api/invoices/${c.id}/analysis`, { method: "POST", body: { justification: "Reanálisis tras confirmación humana de evidencias" } });
      c.reloadAll();
      navigate(`/invoices/${c.id}?run=${r.runId}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <form className={styles.confirm} onSubmit={submit}>
      <h3>Confirmación humana de campos</h3>
      <p className={styles.fine}>
        El original no tiene texto verificable. Revisa visualmente el documento y confirma solo los valores que coinciden exactamente. Queda registrado en la auditoría a tu nombre.
      </p>
      <fieldset>
        <legend className="visually-hidden">Campos a confirmar</legend>
        {fields.map((f) => (
          <label key={f.field} className={styles.check}>
            <input
              type="checkbox"
              checked={chosen.has(f.field)}
              onChange={(e) => {
                const next = new Set(chosen);
                if (e.target.checked) next.add(f.field);
                else next.delete(f.field);
                setChosen(next);
              }}
            />
            <span>
              {fieldLabel(f.field)}: <strong>{String(valueOf(version, f.field) ?? "sin valor")}</strong>
            </span>
          </label>
        ))}
      </fieldset>
      <label className={styles.textareaLabel}>
        Motivo (mínimo 10 caracteres)
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required placeholder="Ej.: Revisé el escaneo original; número, fecha y total coinciden." />
      </label>
      <label className={styles.check}>
        <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} required />
        <span>Revisé el documento original y los valores seleccionados coinciden.</span>
      </label>
      {error && <ErrorPanel error={error} title="No se pudo confirmar" />}
      <Button type="submit" loading={busy} disabled={!valid}>
        Confirmar {chosen.size} {chosen.size === 1 ? "campo" : "campos"} y reanalizar
      </Button>
    </form>
  );
}
