import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import type pg from "pg";
import { PgRateLimitStore } from "../../shared/http/pg-rate-limit-store.js";
import { AppError } from "../../shared/errors/app-error.js";
import { normalizeEmail } from "./auth.service.js";

export interface LoginRateLimitConfig {
  windowMs: number;
  perIp: number;
  perAccount: number;
}

const tooMany = () => new AppError(429, "RATE_LIMITED", "Demasiados intentos de inicio de sesión; inténtalo más tarde");

/**
 * Dos límites para el login, con contadores en PostgreSQL (compartidos entre instancias):
 * - por IP: todos los intentos (frena barridos desde un mismo origen);
 * - por cuenta: solo intentos fallidos (frena fuerza bruta distribuida sobre un correo).
 * La IP depende de TRUST_PROXY: sin proxy de confianza se usa la del socket.
 */
export function createLoginRateLimiters(cfg: LoginRateLimitConfig, pool: pg.Pool): RequestHandler[] {
  const common = {
    windowMs: cfg.windowMs,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, _res, next) => next(tooMany()),
  } as const satisfies Parameters<typeof rateLimit>[0];

  const perIp = rateLimit({
    ...common,
    identifier: "login-ip",
    store: new PgRateLimitStore(pool, "login-ip"),
    limit: cfg.perIp,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
  });

  const perAccount = rateLimit({
    ...common,
    identifier: "login-account",
    store: new PgRateLimitStore(pool, "login-account"),
    limit: cfg.perAccount,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
      const body: unknown = req.body;
      const email = typeof body === "object" && body !== null && "email" in body && typeof body.email === "string" ? body.email : "";
      // Se usa un hash para no mantener correos en claro en memoria.
      return `acct:${createHash("sha256").update(normalizeEmail(email)).digest("hex")}`;
    },
  });

  return [perIp, perAccount];
}
