import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { Link, NavLink } from "react-router";
import { IconAlert, IconClose, IconRefresh } from "./icons.jsx";
import styles from "./ui.module.css";

export function Button({ variant = "primary", size = "md", loading = false, disabled, children, className = "", icon: Icon, ...rest }) {
  return (
    <button className={`${styles.btn} ${styles[variant]} ${styles[`size_${size}`]} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className={styles.spinner} aria-hidden /> : Icon ? <Icon size={16} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function ButtonLink({ variant = "primary", size = "md", icon: Icon, children, className = "", ...rest }) {
  return (
    <Link className={`${styles.btn} ${styles[variant]} ${styles[`size_${size}`]} ${className}`} {...rest}>
      {Icon ? <Icon size={16} /> : null}
      <span>{children}</span>
    </Link>
  );
}

/** Campo etiquetado con ayuda y error asociados por aria-describedby. */
export function Field({ label, hint, error, required, children, id: idProp }) {
  const auto = useId();
  const id = idProp ?? auto;
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className={`${styles.field} ${error ? styles.fieldInvalid : ""}`}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {required && <span className={styles.req} aria-hidden> *</span>}
        {required && <span className="visually-hidden"> (obligatorio)</span>}
      </label>
      {children({ id, "aria-describedby": [hintId, errId].filter(Boolean).join(" ") || undefined, "aria-invalid": error ? true : undefined, required })}
      {hint && !error && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Notice({ tone = "info", title, children, action, icon: Icon }) {
  return (
    <div className={`${styles.notice} ${styles[`notice_${tone}`]}`} role={tone === "danger" ? "alert" : "status"}>
      {Icon && <Icon size={18} />}
      <div className={styles.noticeBody}>
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{title}</p>
      {children && <p className="muted">{children}</p>}
      {action && <div className={styles.emptyAction}>{action}</div>}
    </div>
  );
}

/** Error de carga con mensaje del backend, código y requestId para soporte. */
export function ErrorPanel({ error, onRetry, title = "No se pudo cargar la información" }) {
  if (!error) return null;
  return (
    <div className={styles.errorPanel} role="alert">
      <IconAlert size={20} />
      <div>
        <strong>{title}</strong>
        <p>{error.message}</p>
        {(error.code || error.requestId) && (
          <p className={`${styles.meta} mono`}>
            {error.code}
            {error.requestId ? ` · ${error.requestId.slice(0, 8)}` : ""}
          </p>
        )}
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" icon={IconRefresh} onClick={onRetry}>
          Reintentar
        </Button>
      )}
    </div>
  );
}

export function Skeleton({ lines = 3, label = "Cargando" }) {
  return (
    <div className={styles.skeleton} role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} style={{ width: `${92 - i * 14}%` }} />
      ))}
    </div>
  );
}

export function PageHeader({ eyebrow, title, children, actions, breadcrumbs, aside }) {
  return (
    <header className={styles.pageHeader}>
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <div className={styles.pageHeaderRow}>
        <div className={styles.pageHeaderText}>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <h1 tabIndex={-1} data-page-title>
              {title}
            </h1>
            {aside}
          </div>
          {children && <div className={styles.pageLead}>{children}</div>}
        </div>
        {actions && <div className={styles.pageActions}>{actions}</div>}
      </div>
    </header>
  );
}

export function Breadcrumbs({ items }) {
  return (
    <nav aria-label="Ruta de navegación" className={styles.crumbs}>
      <ol>
        {items.map((it, i) => (
          <li key={i}>{it.to ? <Link to={it.to}>{it.label}</Link> : <span aria-current="page">{it.label}</span>}</li>
        ))}
      </ol>
    </nav>
  );
}

/** Pestañas como ENLACES direccionables (URL estable al refrescar). */
export function TabLinks({ tabs, label }) {
  return (
    <nav aria-label={label} className={styles.tabs}>
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ""}`}>
          {t.label}
          {t.badge != null && <span className={styles.tabBadge}>{t.badge}</span>}
        </NavLink>
      ))}
    </nav>
  );
}

/** Diálogo modal nativo (<dialog>): foco atrapado y Escape por el navegador. */
export function ConfirmDialog({ open, title, children, confirmLabel = "Confirmar", tone = "primary", busy = false, onConfirm, onCancel }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={styles.dialog} onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }} aria-labelledby="dlg-title">
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); onConfirm(); }}>
        <div className={styles.dialogHead}>
          <h2 id="dlg-title">{title}</h2>
          <button type="button" className={styles.iconBtn} onClick={onCancel} disabled={busy} aria-label="Cerrar">
            <IconClose />
          </button>
        </div>
        <div className={styles.dialogBody}>{children}</div>
        <div className={styles.dialogActions}>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" variant={tone} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

const ToastContext = createContext(() => {});
/** Toasts SOLO tras respuesta real del servidor; anunciados por región aria-live. */
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, tone = "success") => {
    const id = Math.random().toString(36).slice(2);
    setItems((xs) => [...xs, { id, message, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className={styles.toasts} aria-live="polite" role="status">
        {items.map((t) => (
          <div key={t.id} className={`${styles.toast} ${styles[`toast_${t.tone}`]}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

export function KeyValue({ items, columns = 2 }) {
  return (
    <dl className={styles.kv} style={{ "--kv-cols": columns }}>
      {items.filter(Boolean).map(([k, v], i) => (
        <div key={i}>
          <dt>{k}</dt>
          <dd>{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
