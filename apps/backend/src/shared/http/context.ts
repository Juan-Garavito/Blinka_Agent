import type { Request } from "express";
import { z } from "zod";
import { userActor, type Actor } from "../../modules/audit/audit.service.js";
import { companyOf } from "../../modules/identity/company-context.js";
import { AppError } from "../errors/app-error.js";

/**
 * Contexto confiable para servicios: empresa resuelta desde la membresía
 * (nunca desde el cuerpo de la petición) y actor autenticado.
 */
export interface CompanyCtx {
  companyId: string;
  actor: Actor;
}

export function ctxOf(req: Request): CompanyCtx {
  if (!req.auth) throw new AppError(401, "UNAUTHENTICATED", "Autenticación requerida");
  return { companyId: companyOf(req).id, actor: userActor(req.auth.userId) };
}

/** Identificador de ruta: un UUID mal formado es 400; uno ajeno o inexistente, 404 (en el servicio). */
export function idParam(req: Request, name: string): string {
  const parsed = z.uuid().safeParse(req.params[name]);
  if (!parsed.success) throw new AppError(400, "INVALID_ID", `Identificador inválido: ${name}`);
  return parsed.data;
}

export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
