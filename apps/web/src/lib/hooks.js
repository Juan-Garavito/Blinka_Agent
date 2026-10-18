import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";

/**
 * Carga un recurso GET con cancelación al desmontar o al cambiar la clave.
 * Conserva el último dato mientras recarga (sin parpadeo).
 */
export function useResource(path, { enabled = true } = {}) {
  const [nonce, setNonce] = useState(0);
  const key = path && enabled ? `${path}#${nonce}` : null;
  const [state, setState] = useState({ key: null, data: null, error: null });
  useEffect(() => {
    if (!key) return undefined;
    const ctrl = new AbortController();
    api(path, { signal: ctrl.signal })
      .then((data) => setState({ key, data, error: null }))
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setState((s) => ({ key, data: s.data, error }));
      });
    return () => ctrl.abort();
  }, [key, path]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  // `loading` se deriva: la clave pedida aún no tiene resultado (se conserva el dato anterior).
  return { data: state.data, error: state.key === key ? state.error : null, loading: Boolean(key) && state.key !== key, reload };
}

/**
 * Polling controlado: intervalo fijo, pausa con la pestaña oculta, se detiene
 * cuando `isDone(data)` es verdadero, al desmontar, y tras errores repetidos
 * conserva el último estado e informa `stale` (sin borrar la pantalla).
 */
export function usePolling(path, { intervalMs = 2500, isDone = () => false, enabled = true, maxErrors = 4 } = {}) {
  const [state, setState] = useState({ path: null, data: null, error: null, stale: false, done: false });
  const isDoneRef = useRef(isDone);
  isDoneRef.current = isDone;
  useEffect(() => {
    if (!path || !enabled) return undefined;
    let timer;
    let errors = 0;
    let stopped = false;
    let ctrl;
    const tick = async () => {
      if (stopped) return;
      if (document.hidden) {
        timer = setTimeout(tick, intervalMs);
        return;
      }
      ctrl = new AbortController();
      try {
        const data = await api(path, { signal: ctrl.signal, timeoutMs: 10000 });
        errors = 0;
        const done = Boolean(isDoneRef.current(data));
        setState({ path, data, error: null, stale: false, done });
        if (done) return;
      } catch (error) {
        if (error?.name === "AbortError") return;
        errors += 1;
        setState((s) => ({ ...(s.path === path ? s : { data: null, done: false }), path, error, stale: true }));
        if (error.status && error.status !== 0 && error.status < 500 && error.status !== 429) return; // errores definitivos
        if (errors >= maxErrors) return;
      }
      // Reintentos moderados: el intervalo crece con errores consecutivos.
      timer = setTimeout(tick, intervalMs * (1 + errors));
    };
    tick();
    const onVisible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      ctrl?.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [path, intervalMs, enabled, maxErrors]);
  // El estado pertenece a la ruta consultada: al cambiar de corrida no se arrastra el resultado anterior.
  return state.path === path && path ? state : { data: null, error: null, stale: false, done: false };
}

/** Preferencia de movimiento reducido (para timelines GSAP). */
export function usePrefersReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    const fn = () => setReduced(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return reduced;
}

/** Recarga periódica SOLO mientras `active` (p. ej. hay análisis reales en curso) y la pestaña es visible. */
export function useAutoRefresh(reload, active, intervalMs = 4000) {
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => {
      if (!document.hidden) reload();
    }, intervalMs);
    return () => clearInterval(t);
  }, [reload, active, intervalMs]);
}
