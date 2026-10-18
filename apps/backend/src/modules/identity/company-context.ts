import type { Request, RequestHandler } from "express";
import { z } from "zod";
import { AppError } from "../../shared/errors/app-error.js";
import type { CompanySummary, IdentityRepository } from "./identity.repository.js";

export const COMPANY_HEADER = "x-company-id";

const companyId = z.uuid();

/**
 * Resuelve la empresa autorizada a partir del usuario autenticado y su
 * membresía. Un company_id enviado por el cliente (cabecera X-Company-Id) es
 * solo una SELECCIÓN: se acepta únicamente si existe una membresía activa en
 * una empresa activa. Empresa inexistente y empresa ajena producen el mismo
 * 403, para no revelar qué identificadores existen.
 * Sin cabecera: se usa la única empresa del usuario; con varias, se exige elegir.
 */
export function requireCompanyContext(repo: Pick<IdentityRepository, "findUsableCompany" | "listUsableCompanies">): RequestHandler {
  return async (req, _res, next) => {
    if (!req.auth) return next(new AppError(401, "UNAUTHENTICATED", "Autenticación requerida"));
    const requested = req.get(COMPANY_HEADER);

    if (requested !== undefined) {
      if (!companyId.safeParse(requested).success) {
        return next(new AppError(400, "INVALID_COMPANY_ID", "Identificador de empresa inválido"));
      }
      const company = await repo.findUsableCompany(req.auth.userId, requested);
      if (!company) return next(new AppError(403, "COMPANY_ACCESS_DENIED", "Sin acceso a la empresa solicitada"));
      req.company = company;
      return next();
    }

    const companies = await repo.listUsableCompanies(req.auth.userId);
    if (companies.length === 0) return next(new AppError(403, "NO_COMPANY_ACCESS", "El usuario no tiene empresas asignadas"));
    if (companies.length > 1) {
      return next(new AppError(400, "COMPANY_SELECTION_REQUIRED", `Indica la empresa con la cabecera ${COMPANY_HEADER}`));
    }
    req.company = companies[0];
    next();
  };
}

/** Para servicios: obtiene la empresa ya autorizada o falla de forma explícita. */
export function companyOf(req: Request): CompanySummary {
  if (!req.company) throw new AppError(500, "COMPANY_CONTEXT_MISSING", "Contexto de empresa no resuelto", { expose: false });
  return req.company;
}
