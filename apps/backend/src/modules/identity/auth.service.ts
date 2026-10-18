import { createHash, randomBytes } from "node:crypto";
import { AppError } from "../../shared/errors/app-error.js";
import type { Logger } from "../../shared/logger.js";
import type { CompanySummary, IdentityRepository } from "./identity.repository.js";
import { getDummyHash, hashPassword, needsRehash, verifyPassword } from "./password.js";

export interface AuthConfig {
  sessionTtlMs: number;
  idleTimeoutMs: number;
  /** Frecuencia mínima para actualizar last_seen_at (reduce escrituras). */
  touchIntervalMs: number;
}

export interface AuthenticatedSession {
  sessionId: string;
  userId: string;
  email: string;
  csrfToken: string;
  expiresAt: Date;
}

export type SessionInvalidReason = "MALFORMED" | "NOT_FOUND" | "REVOKED" | "EXPIRED" | "IDLE_TIMEOUT" | "USER_INACTIVE";

export type SessionResolution =
  | { ok: true; session: AuthenticatedSession }
  | { ok: false; reason: SessionInvalidReason };

/** 32 bytes aleatorios en base64url = 43 caracteres. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const hashSessionToken = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const invalidCredentials = () =>
  new AppError(401, "INVALID_CREDENTIALS", "Correo o contraseña incorrectos");

export function createAuthService(deps: {
  repo: IdentityRepository;
  config: AuthConfig;
  logger: Logger;
  now?: () => Date;
}) {
  const { repo, config, logger } = deps;
  const now = deps.now ?? (() => new Date());

  async function resolveSession(token: string): Promise<SessionResolution> {
    if (!TOKEN_PATTERN.test(token)) return { ok: false, reason: "MALFORMED" };
    const record = await repo.findSessionByTokenHash(hashSessionToken(token));
    if (!record) return { ok: false, reason: "NOT_FOUND" };
    if (record.revokedAt) return { ok: false, reason: "REVOKED" };
    const at = now();
    if (record.expiresAt.getTime() <= at.getTime()) return { ok: false, reason: "EXPIRED" };
    if (at.getTime() - record.lastSeenAt.getTime() >= config.idleTimeoutMs) return { ok: false, reason: "IDLE_TIMEOUT" };
    if (!record.userActive) return { ok: false, reason: "USER_INACTIVE" };

    if (at.getTime() - record.lastSeenAt.getTime() >= config.touchIntervalMs) {
      await repo.touchSession(record.id, at);
    }
    return {
      ok: true,
      session: {
        sessionId: record.id,
        userId: record.userId,
        email: record.email,
        csrfToken: record.csrfToken,
        expiresAt: record.expiresAt,
      },
    };
  }

  return {
    resolveSession,

    /**
     * Verifica credenciales y crea SIEMPRE una sesión nueva (identificador
     * regenerado). Si llegó una cookie de sesión previa, esa sesión se revoca.
     * El mismo error y un coste de verificación equivalente para correo
     * inexistente, usuario inactivo o contraseña incorrecta.
     */
    async login(input: { email: string; password: string; userAgent: string | null; previousToken?: string }) {
      const email = normalizeEmail(input.email);
      const user = await repo.findUserByEmail(email);

      if (!user || !user.active) {
        await verifyPassword(await getDummyHash(), input.password);
        throw invalidCredentials();
      }
      if (!(await verifyPassword(user.passwordHash, input.password))) throw invalidCredentials();

      if (needsRehash(user.passwordHash)) {
        await repo.updatePasswordHash(user.id, await hashPassword(input.password));
        logger.info({ userId: user.id }, "Hash de contraseña actualizado a los parámetros vigentes");
      }

      if (input.previousToken && TOKEN_PATTERN.test(input.previousToken)) {
        const previous = await repo.findSessionByTokenHash(hashSessionToken(input.previousToken));
        if (previous) await repo.revokeSession(previous.id, "REGENERATED", now());
      }

      const token = newToken();
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + config.sessionTtlMs);
      const csrfToken = newToken();
      const { id } = await repo.insertSession({
        tokenHash: hashSessionToken(token),
        userId: user.id,
        csrfToken,
        userAgent: input.userAgent?.slice(0, 256) ?? null,
        createdAt,
        expiresAt,
      });
      const companies: CompanySummary[] = await repo.listUsableCompanies(user.id);

      logger.info({ userId: user.id, sessionId: id }, "Inicio de sesión");
      return {
        token,
        session: { sessionId: id, userId: user.id, email: user.email, csrfToken, expiresAt } satisfies AuthenticatedSession,
        companies,
      };
    },

    async logout(sessionId: string) {
      await repo.revokeSession(sessionId, "LOGOUT", now());
    },

    listCompanies: (userId: string) => repo.listUsableCompanies(userId),
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
