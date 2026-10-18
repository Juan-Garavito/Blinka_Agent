import { parseCookie } from "cookie";
import type { CookieOptions, Request, Response } from "express";

export interface SessionCookieConfig {
  secure: boolean;
  sameSite: "strict" | "lax";
}

/**
 * Con Secure se usa el prefijo __Host-: el navegador exige Secure, Path=/ y
 * prohíbe Domain, así que ningún subdominio puede fijar o pisar la cookie.
 */
export const sessionCookieName = (cfg: SessionCookieConfig) => (cfg.secure ? "__Host-blinka_session" : "blinka_session");

const baseOptions = (cfg: SessionCookieConfig): CookieOptions => ({
  httpOnly: true,
  secure: cfg.secure,
  sameSite: cfg.sameSite,
  path: "/",
});

export function setSessionCookie(res: Response, cfg: SessionCookieConfig, token: string, expiresAt: Date): void {
  res.cookie(sessionCookieName(cfg), token, { ...baseOptions(cfg), expires: expiresAt });
}

export function clearSessionCookie(res: Response, cfg: SessionCookieConfig): void {
  res.clearCookie(sessionCookieName(cfg), baseOptions(cfg));
}

export function readSessionCookie(req: Request, cfg: SessionCookieConfig): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  return parseCookie(header)[sessionCookieName(cfg)];
}
