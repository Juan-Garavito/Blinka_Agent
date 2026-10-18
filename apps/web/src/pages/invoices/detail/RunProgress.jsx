import { useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { usePrefersReducedMotion } from "../../../lib/hooks.js";
import { formatDuration } from "../../../lib/format.js";
import { IconAlert, IconCheck, IconRefresh } from "../../../components/icons.jsx";
import { PROCESSING_LABEL, STAGES } from "./rules.js";
import styles from "./Detail.module.css";

gsap.registerPlugin(useGSAP);

/**
 * Progreso REAL de la corrida (etapas de `agent_stage_runs` vía polling). Cada etapa se anima solo cuando el
 * backend informa un cambio de estado; con movimiento reducido no hay animación.
 */
export function RunProgress({ run, stale, compact = false }) {
  const ref = useRef(null);
  const reduced = usePrefersReducedMotion();
  const stages = STAGES.map((s) => {
    const attempts = (run?.stages ?? []).filter((x) => x.stage === s.code);
    const last = attempts.at(-1);
    return { ...s, last, attempts: attempts.length };
  });
  const signature = stages.map((s) => `${s.code}:${s.last?.status ?? "-"}`).join("|");

  useGSAP(
    () => {
      if (reduced || !ref.current) return;
      const changed = ref.current.querySelectorAll('[data-status="SUCCEEDED"] [data-mark]:not([data-seen]), [data-status="RUNNING"] [data-mark]:not([data-seen])');
      changed.forEach((el) => el.setAttribute("data-seen", el.closest("[data-status]").dataset.status));
      if (changed.length) gsap.fromTo(changed, { scale: 0.6, opacity: 0.4 }, { scale: 1, opacity: 1, duration: 0.26, ease: "back.out(2)", stagger: 0.06 });
    },
    { scope: ref, dependencies: [signature, reduced] },
  );

  return (
    <div className={`${styles.progress} ${compact ? styles.progressCompact : ""}`} ref={ref}>
      <p className={styles.progressHead} aria-live="polite">
        <strong>{run ? PROCESSING_LABEL[run.processing] ?? run.processing : "Conectando con el análisis…"}</strong>
        {run && <span className="muted"> · corrida {run.runNo}</span>}
        {stale && <span className={styles.stale}> · sin conexión, mostrando el último estado conocido</span>}
      </p>
      <ol className={styles.stageList}>
        {stages.map((s) => {
          const st = s.last?.status ?? "PENDING";
          return (
            <li key={s.code} data-status={st}>
              <span className={styles.stageMark} data-mark aria-hidden>
                {st === "SUCCEEDED" ? <IconCheck size={14} /> : st === "FAILED" ? <IconAlert size={14} /> : null}
              </span>
              <span className={styles.stageText}>
                <strong>{s.label}</strong>
                <span className="muted">
                  {st === "PENDING" && "Pendiente"}
                  {st === "RUNNING" && "En curso…"}
                  {st === "SUCCEEDED" && (s.last.reused ? "Reutilizada de un análisis previo (misma huella)" : `Completada${formatDuration(s.last.startedAt, s.last.finishedAt) ? ` en ${formatDuration(s.last.startedAt, s.last.finishedAt)}` : ""}`)}
                  {st === "FAILED" && `Falló${s.last.errorCode ? ` · ${s.last.errorCode}` : ""}`}
                  {s.attempts > 1 && (
                    <>
                      {" "}
                      · <IconRefresh size={12} /> intento {s.attempts}
                    </>
                  )}
                </span>
                {!compact && <span className={styles.stageHint}>{s.hint}</span>}
              </span>
              <span className="visually-hidden">Estado: {st}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
