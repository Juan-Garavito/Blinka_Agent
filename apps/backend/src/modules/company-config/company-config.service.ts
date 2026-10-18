import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../shared/db/client.js";
import { notFound } from "../../shared/errors/app-error.js";
import type { CompanyCtx } from "../../shared/http/context.js";
import { recordAudit } from "../audit/audit.service.js";
import { approvalPersonas, expenseCategories } from "./company-config.schema.js";

export const categoryInput = z
  .object({
    code: z
      .string()
      .trim()
      .transform((v) => v.toUpperCase())
      .pipe(z.string().regex(/^[A-Z0-9_-]{2,40}$/)),
    name: z.string().trim().min(1).max(120),
  })
  .strict();
export const categoryPatch = z.object({ name: z.string().trim().min(1).max(120).optional(), active: z.boolean().optional() }).strict();

export const personaInput = z
  .object({ displayName: z.string().trim().min(1).max(120), designation: z.string().trim().min(1).max(120) })
  .strict();
export const personaPatch = personaInput.partial().extend({ active: z.boolean().optional() }).strict();

export function createCompanyConfigService(db: Database) {
  return {
    listCategories: (ctx: CompanyCtx) =>
      db.select().from(expenseCategories).where(eq(expenseCategories.companyId, ctx.companyId)).orderBy(asc(expenseCategories.code)),

    async createCategory(ctx: CompanyCtx, input: z.infer<typeof categoryInput>) {
      return db.transaction(async (tx) => {
        const [row] = await tx.insert(expenseCategories).values({ companyId: ctx.companyId, ...input }).returning();
        await recordAudit(tx, { companyId: ctx.companyId, actor: ctx.actor, eventType: "category.created", entityType: "expense_category", entityRef: row!.id, details: { code: row!.code } });
        return row!;
      });
    },

    async updateCategory(ctx: CompanyCtx, id: string, patch: z.infer<typeof categoryPatch>) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(expenseCategories)
          .set(patch)
          .where(and(eq(expenseCategories.id, id), eq(expenseCategories.companyId, ctx.companyId)))
          .returning();
        if (!row) throw notFound("Categoría no encontrada");
        await recordAudit(tx, { companyId: ctx.companyId, actor: ctx.actor, eventType: "category.updated", entityType: "expense_category", entityRef: id, details: patch });
        return row;
      });
    },

    listPersonas: (ctx: CompanyCtx) =>
      db.select().from(approvalPersonas).where(eq(approvalPersonas.companyId, ctx.companyId)).orderBy(asc(approvalPersonas.displayName)),

    async createPersona(ctx: CompanyCtx, input: z.infer<typeof personaInput>) {
      return db.transaction(async (tx) => {
        const [row] = await tx.insert(approvalPersonas).values({ companyId: ctx.companyId, ...input }).returning();
        await recordAudit(tx, { companyId: ctx.companyId, actor: ctx.actor, eventType: "approval_persona.created", entityType: "approval_persona", entityRef: row!.id });
        return row!;
      });
    },

    async updatePersona(ctx: CompanyCtx, id: string, patch: z.infer<typeof personaPatch>) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(approvalPersonas)
          .set(patch)
          .where(and(eq(approvalPersonas.id, id), eq(approvalPersonas.companyId, ctx.companyId)))
          .returning();
        if (!row) throw notFound("Persona aprobadora no encontrada");
        await recordAudit(tx, { companyId: ctx.companyId, actor: ctx.actor, eventType: "approval_persona.updated", entityType: "approval_persona", entityRef: id, details: patch });
        return row;
      });
    },
  };
}

export type CompanyConfigService = ReturnType<typeof createCompanyConfigService>;
