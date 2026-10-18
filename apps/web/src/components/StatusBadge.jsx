import { IconBlock, IconCheckCircle, IconClock, IconCpu, IconEdit, IconHourglass, IconX, IconAlert } from "./icons.jsx";
import styles from "./StatusBadge.module.css";

/**
 * Seis estados de NEGOCIO (texto + icono + explicación, nunca solo color) y
 * estados TÉCNICOS de procesamiento, visualmente distintos (sin relleno).
 */
export const BUSINESS_STATUS = {
  AUTORIZADA: { label: "Autorizada", tone: "authorized", Icon: IconCheckCircle, explain: "Autorización y reserva presupuestaria SIMULADAS confirmadas por el motor. No se transfiere dinero." },
  EN_APROBACION: { label: "En aprobación", tone: "approval", Icon: IconHourglass, explain: "Requiere intervención humana simulada (importe sobre el umbral o proveedor/cuenta por habilitar)." },
  EN_CORRECCION: { label: "En corrección", tone: "correction", Icon: IconEdit, explain: "Faltan datos o evidencias, o hay una discrepancia corregible. Requiere corrección, no aprobación." },
  BLOQUEADA: { label: "Bloqueada", tone: "blocked", Icon: IconBlock, explain: "Incumple una regla obligatoria (tope, duplicado, presupuesto, proveedor/cuenta bloqueados). No se anula con una aprobación." },
  RECHAZADA: { label: "Rechazada", tone: "rejected", Icon: IconX, explain: "Rechazo humano simulado. Es distinto de un bloqueo por política." },
  ERROR: { label: "Error técnico", tone: "error", Icon: IconAlert, explain: "Falla técnica (IA, FX, servicio). No implica decisión financiera; admite reintento seguro." },
};

export const TECH_STATUS = {
  PROCESSING: { label: "Analizando", Icon: IconCpu, explain: "Análisis en curso en el worker (estado técnico, no comercial)." },
  NOT_EVALUATED: { label: "Sin evaluar", Icon: IconClock, explain: "Aún no tiene una decisión del motor." },
};

export function StatusBadge({ status, processing = false, size = "md", withExplain = false }) {
  if (processing) return <TechBadge kind="PROCESSING" size={size} withExplain={withExplain} />;
  const s = BUSINESS_STATUS[status];
  if (!s) return <TechBadge kind="NOT_EVALUATED" size={size} withExplain={withExplain} />;
  const { Icon } = s;
  return (
    <span className={`${styles.badge} ${styles[s.tone]} ${styles[size]}`} title={s.explain}>
      <Icon size={size === "lg" ? 18 : 14} />
      <span>{s.label}</span>
      {withExplain && <span className="visually-hidden">. {s.explain}</span>}
    </span>
  );
}

export function TechBadge({ kind, size = "md", label, withExplain = false }) {
  const t = TECH_STATUS[kind];
  const { Icon } = t;
  return (
    <span className={`${styles.badge} ${styles.tech} ${styles[size]} ${kind === "PROCESSING" ? styles.processing : ""}`} title={t.explain}>
      <Icon size={14} />
      <span>{label ?? t.label}</span>
      {withExplain && <span className="visually-hidden">. {t.explain}</span>}
    </span>
  );
}
