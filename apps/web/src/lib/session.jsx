import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, onUnauthorized, setCsrfToken } from "./api.js";

/**
 * Sesión del evaluador. La credencial real es la cookie HttpOnly emitida por
 * Express; aquí solo se guarda en MEMORIA el usuario, la empresa y el token CSRF.
 */
const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [state, setState] = useState({ status: "loading", user: null, companies: [], expired: false });

  const apply = useCallback((s) => {
    setCsrfToken(s.csrfToken);
    setState({ status: "authenticated", user: s.user, companies: s.companies, expiresAt: s.expiresAt, expired: false });
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    api("/api/auth/session", { signal: ctrl.signal, skipUnauthorizedHandler: true })
      .then(apply)
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setCsrfToken(null);
        setState({ status: "anonymous", user: null, companies: [], expired: false });
      });
    return () => ctrl.abort();
  }, [apply]);

  useEffect(
    () =>
      onUnauthorized((err) => {
        setCsrfToken(null);
        setState((prev) => (prev.status === "authenticated" ? { status: "anonymous", user: null, companies: [], expired: true, reason: err.code } : prev));
      }),
    [],
  );

  const login = useCallback(
    async (email, password) => {
      const s = await api("/api/auth/login", { method: "POST", body: { email, password }, skipUnauthorizedHandler: true });
      apply(s);
      return s;
    },
    [apply],
  );

  const logout = useCallback(async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      setCsrfToken(null);
      setState({ status: "anonymous", user: null, companies: [], expired: false });
    }
  }, []);

  const value = useMemo(() => ({ ...state, company: state.companies[0] ?? null, login, logout }), [state, login, logout]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession fuera de SessionProvider");
  return ctx;
}
