import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { Brand } from "../app/AppShell.jsx";
import { IconShield } from "../components/icons.jsx";
import { Button, Field, Notice } from "../components/ui.jsx";
import { useSession } from "../lib/session.jsx";
import styles from "./Login.module.css";

/** Solo rutas internas como destino posterior (evita redirecciones abiertas). */
export function safeNext(next) {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/";
}

export default function Login() {
  const { status, login, expired } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const next = safeNext(new URLSearchParams(location.search).get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (status === "authenticated") return <Navigate to={next} replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(
        err.status === 429
          ? "Demasiados intentos. Espera unos minutos antes de volver a intentarlo."
          : err.code === "INVALID_CREDENTIALS"
            ? "Correo o contraseña incorrectos."
            : err.status === 0
              ? err.message
              : "No se pudo iniciar sesión. Inténtalo de nuevo.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.intro} aria-hidden="false">
        <Brand />
        <div className={styles.statement}>
          <p className="eyebrow">Cuentas por pagar · Control previo</p>
          <h1 className={styles.title}>Cada factura, contrastada con su contrato, sus políticas y su presupuesto antes de autorizarse.</h1>
          <p className={styles.lead}>Un motor determinista decide. La IA solo extrae y documenta evidencia verificable.</p>
        </div>
        <p className={styles.foot}>Hackatón 30X · Reto Blinka · Blinka FacturAction</p>
      </section>
      <section className={styles.panel}>
        <form className={styles.form} onSubmit={onSubmit} noValidate>
          <div className={styles.formHead}>
            <h2>Iniciar sesión</h2>
            <p className="muted">Acceso del evaluador de la empresa ficticia.</p>
          </div>
          {expired && !error && <Notice tone="warning" title="Tu sesión expiró">Vuelve a iniciar sesión para continuar donde estabas.</Notice>}
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="Correo electrónico" required>
            {(p) => <input {...p} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Field label="Contraseña" required>
            {(p) => (
              <div className={styles.pw}>
                <input {...p} type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" className={styles.pwToggle} onClick={() => setShow((s) => !s)} aria-pressed={show} aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}>
                  {show ? "Ocultar" : "Mostrar"}
                </button>
              </div>
            )}
          </Field>
          <Button type="submit" size="lg" loading={busy} disabled={!email || !password}>
            Iniciar sesión
          </Button>
          <Notice tone="demo" icon={IconShield}>
            Entorno de demostración · Autorizaciones simuladas · Sin pagos reales
          </Notice>
        </form>
      </section>
    </div>
  );
}
