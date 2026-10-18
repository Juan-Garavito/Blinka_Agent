import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { AppError } from "../../shared/errors/app-error.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const BODY_TYPES = ["application/json", "application/pdf", "image/png", "image/jpeg"];

const safeEqual = (a: string, b: string) => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

/**
 * Protección CSRF por capas para métodos que modifican estado:
 * 1. Origen: si el navegador envía Origin, debe estar en la lista permitida;
 *    sin Origin, se rechaza Sec-Fetch-Site=cross-site.
 * 2. Cuerpo solo JSON o archivo (PDF/PNG/JPEG): un formulario HTML entre
 *    sitios no puede enviar esos tipos sin una preflight CORS (que no se concede).
 * 3. Token sincronizador: con sesión activa, X-CSRF-Token debe coincidir con
 *    el token de la sesión (no aplica al login, que no tiene sesión previa).
 * Las cookies SameSite=Strict son una capa adicional, no la única.
 */
export function csrfProtection(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();

    const origin = req.get("origin");
    if (origin !== undefined) {
      if (!allowed.has(origin)) return next(new AppError(403, "CSRF_ORIGIN_REJECTED", "Origen no permitido"));
    } else if (req.get("sec-fetch-site") === "cross-site") {
      return next(new AppError(403, "CSRF_ORIGIN_REJECTED", "Origen no permitido"));
    }

    const hasBody = Number(req.get("content-length") ?? 0) > 0 || req.get("transfer-encoding") !== undefined;
    if (hasBody && !req.is(BODY_TYPES)) {
      return next(new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "El cuerpo debe ser application/json o un documento admitido"));
    }

    if (req.auth) {
      const token = req.get("x-csrf-token");
      if (!token || !safeEqual(token, req.auth.csrfToken)) {
        return next(new AppError(403, "CSRF_TOKEN_INVALID", "Token CSRF ausente o inválido"));
      }
    }
    next();
  };
}
