import styles from "./StatusBadge.module.css";
import { IconBlock, IconCheckCircle, IconHourglass } from "./icons.jsx";

/** Estado del PROVEEDOR (maestro), distinto del estado de una factura. */
export const VENDOR_STATUS = {
  AUTHORIZED: { label: "Habilitado", tone: "authorized", Icon: IconCheckCircle, consequence: "Puede facturar; el motor evalúa contrato, política y presupuesto." },
  PENDING: { label: "Pendiente de habilitación", tone: "approval", Icon: IconHourglass, consequence: "Sus facturas quedan En aprobación hasta que el proveedor sea habilitado." },
  BLOCKED: { label: "Bloqueado", tone: "blocked", Icon: IconBlock, consequence: "Sus facturas serán Bloqueadas por política; una aprobación no lo anula." },
};

export function VendorStatusBadge({ status, size = "sm" }) {
  const s = VENDOR_STATUS[status] ?? { label: status, tone: "tech", Icon: IconHourglass };
  const { Icon } = s;
  return (
    <span className={`${styles.badge} ${styles[s.tone]} ${styles[size]}`} title={s.consequence}>
      <Icon size={14} />
      <span>{s.label}</span>
    </span>
  );
}

export const BILLING_TYPE = { RECURRING: "Recurrente", HOURLY: "Por horas", MILESTONE: "Por hitos", PURCHASE_ORDER: "Orden de compra" };
