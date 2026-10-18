import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { IconChevronDown, IconClose, IconFlask, IconMenu, IconUser } from "../components/icons.jsx";
import { useResource } from "../lib/hooks.js";
import { useSession } from "../lib/session.jsx";
import { NAV_GROUPS, groupForPath } from "./nav.js";
import styles from "./AppShell.module.css";

export function Brand() {
  return (
    <Link to="/" className={styles.brand} aria-label="Blinka PayGuard AI — Centro de operaciones">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="6" fill="#153454" />
        <path d="M9 8h8.5a5 5 0 0 1 1.6 9.7A5.2 5.2 0 0 1 17.8 26H9z" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round" />
        <circle cx="23.5" cy="9" r="2.2" fill="#D6A357" />
      </svg>
      <span className={styles.brandText}>
        Blinka <span>PayGuard</span>
      </span>
    </Link>
  );
}

/** Rotula qué es real y qué es simulado, a partir de /api/system/environment. */
function EnvironmentStrip() {
  const { data } = useResource("/api/system/environment");
  if (!data) return null;
  const parts = ["Entorno de demostración", "Autorizaciones y reservas simuladas · sin pagos reales"];
  if (data.ai.simulated) parts.push(`IA simulada (${data.ai.provider})`);
  else parts.push(`IA: ${data.ai.provider} · ${data.ai.model}`);
  if (data.fx.simulated) parts.push("Tipo de cambio simulado (FIXTURE)");
  else parts.push(`Tipo de cambio: ${data.fx.provider}`);
  return (
    <div className={styles.envStrip} role="note" aria-label="Estado del entorno">
      <details className={styles.envMobile}>
      <summary>Demo · sin pagos reales · {data.ai.simulated ? "IA simulada" : "IA real"} · FX {data.fx.simulated ? "simulado" : "real"}</summary>
      <div className={styles.envDetails}>
      <IconFlask size={14} />
      {parts.map((p, i) => (
        <span key={i}>{p}</span>
      ))}
      </div>
      </details>
      <div className={styles.envDesktop}><IconFlask size={14} />{parts.map((p, i) => <span key={i}>{p}</span>)}</div>
    </div>
  );
}

function UserMenu() {
  const { user, company, logout } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className={styles.userMenu} ref={ref}>
      <button className={styles.userBtn} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <IconUser size={18} />
        <span className={styles.userEmail}>{user?.email}</span>
        <IconChevronDown size={14} />
      </button>
      {open && (
        <div className={styles.dropdown} role="menu">
          <div className={styles.dropdownMeta}>
            <span className="eyebrow">Evaluador autenticado</span>
            <span>{company?.name}</span>
          </div>
          <Link role="menuitem" to="/settings" onClick={() => setOpen(false)}>
            Configuración
          </Link>
          <Link role="menuitem" to="/style-guide" onClick={() => setOpen(false)}>
            Guía de componentes
          </Link>
          <button
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              await logout();
              navigate("/login", { replace: true });
            }}
          >
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}

function MobileMenu({ onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.querySelector("a")?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <nav id="mobile-menu" className={styles.mobileMenu} aria-label="Navegación principal" ref={ref}>
      {NAV_GROUPS.map((g) => (
        <div key={g.id} className={styles.mobileGroup}>
          <p className="eyebrow">{g.label}</p>
          {g.items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} onClick={onClose} className={({ isActive }) => (isActive ? styles.mobileActive : undefined)}>
              {i.label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function AppShell() {
  const location = useLocation();
  const group = groupForPath(location.pathname);
  // El menú móvil queda abierto solo en la ruta donde se abrió (se cierra al navegar).
  const [openOn, setOpenOn] = useState(null);
  const mobileOpen = openOn === location.pathname;
  const setMobileOpen = (fn) => setOpenOn((cur) => ((typeof fn === "function" ? fn(cur === location.pathname) : fn) ? location.pathname : null));
  const mainRef = useRef(null);

  // Accesibilidad: al cambiar de ruta, el foco va al título de la vista (sin scroll forzado entre pestañas).
  useEffect(() => {
    const h1 = mainRef.current?.querySelector("[data-page-title]");
    if (h1) h1.focus({ preventScroll: true });
  }, [location.pathname]);

  return (
    <div className={styles.shell}>
      <a className="skip-link" href="#main">
        Saltar al contenido
      </a>
      <EnvironmentStrip />
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Brand />
          <nav className={styles.groups} aria-label="Navegación principal">
            {NAV_GROUPS.map((g) => (
              <NavLink key={g.id} to={g.items[0].to} end={g.items[0].end} className={() => `${styles.group} ${g.id === group.id ? styles.groupActive : ""}`} aria-current={g.id === group.id ? "true" : undefined}>
                {g.label}
              </NavLink>
            ))}
          </nav>
          <div className={styles.headerEnd}>
            <UserMenu />
            <button className={styles.menuBtn} aria-expanded={mobileOpen} aria-controls="mobile-menu" onClick={() => setMobileOpen((o) => !o)} aria-label={mobileOpen ? "Cerrar menú" : "Abrir menú"}>
              {mobileOpen ? <IconClose /> : <IconMenu />}
            </button>
          </div>
        </div>
        {group.items.length > 1 && (
          <nav className={styles.subnav} aria-label={`Secciones de ${group.label}`}>
            <div className={styles.subnavInner}>
              {group.items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `${styles.subLink} ${isActive ? styles.subActive : ""}`}>
                  {i.label}
                </NavLink>
              ))}
            </div>
          </nav>
        )}
        {mobileOpen && <MobileMenu onClose={() => setMobileOpen(false)} />}
      </header>
      <main id="main" ref={mainRef} className={styles.main}>
        <div key={location.pathname.split("/").slice(0, 3).join("/")} className={styles.routeFade}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
