import type { RequestHandler } from "express";
import { AppError } from "../../shared/errors/app-error.js";
import type { AuthService } from "./auth.service.js";
import { clearSessionCookie, readSessionCookie, type SessionCookieConfig } from "./session-cookie.js";

/**
 * Resuelve la sesión desde la cookie (si existe) y la deja en `req.auth`.
 * No exige autenticación: eso lo hace `requireAuth`. Una cookie inválida,
 * revocada o expirada se borra del navegador.
 */
export function loadSession(auth: AuthService, cookies: SessionCookieConfig): RequestHandler {
  return async (req, res, next) => {
    const token = readSessionCookie(req, cookies);
    if (!token) return next();
    const result = await auth.resolveSession(token);
    if (result.ok) {
      req.auth = result.session;
    } else {
      req.sessionInvalidReason = result.reason;
      clearSessionCookie(res, cookies);
    }
    next();
  };
}

export const requireAuth: RequestHandler = (req, res, next) => {
  if (req.auth) {
    res.set("Cache-Control", "no-store");
    return next();
  }
  const expired = req.sessionInvalidReason === "EXPIRED" || req.sessionInvalidReason === "IDLE_TIMEOUT";
  next(
    expired
      ? new AppError(401, "SESSION_EXPIRED", "La sesión expiró; inicia sesión de nuevo")
      : new AppError(401, "UNAUTHENTICATED", "Autenticación requerida"),
  );
};
