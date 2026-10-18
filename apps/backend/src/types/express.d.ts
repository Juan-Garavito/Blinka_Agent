import type { AuthenticatedSession, SessionInvalidReason } from "../modules/identity/auth.service.js";
import type { CompanySummary } from "../modules/identity/identity.repository.js";

declare global {
  namespace Express {
    interface Request {
      /** Sesión válida resuelta desde la cookie (middleware loadSession). */
      auth?: AuthenticatedSession;
      /** Motivo por el que una cookie presente no produjo sesión. */
      sessionInvalidReason?: SessionInvalidReason;
      /** Empresa autorizada para esta petición (middleware requireCompanyContext). */
      company?: CompanySummary;
    }
  }
}

export {};
