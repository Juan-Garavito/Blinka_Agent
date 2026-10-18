import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../shared/db/client.js";
import { AppError, notFound } from "../../shared/errors/app-error.js";
import type { CompanyCtx } from "../../shared/http/context.js";
import { D, moneyString } from "../../shared/money.js";
import { recordAudit, type Executor } from "../audit/audit.service.js";
import { approvalMatrixRules, companyPolicies, POLICY_SCOPES, policyVersions } from "./policies.schema.js";

const matrixRule = z.object({ minAmountExclusive: moneyString, maxAmountInclusive: moneyString.optional(), personaId: z.uuid() }).strict();

/** Condiciones tipadas; importes en moneda base como strings decimales. */
export const policyVersionInput = z
  .object({
    effectiveFrom: z.iso.datetime({ offset: true }).optional(),
    autoApprovalLimitBase: moneyString.optional(),
    hardInvoiceCapBase: moneyString.optional(),
    matrix: z.array(matrixRule).max(20).default([]),
  })
  .strict()
  .refine((v) => !v.autoApprovalLimitBase || !v.hardInvoiceCapBase || new D(v.autoApprovalLimitBase).lte(v.hardInvoiceCapBase), {
    error: "autoApprovalLimitBase no puede superar hardInvoiceCapBase",
  });

export const policyCreateBody = z
  .object({
    scopeLevel: z.enum(POLICY_SCOPES),
    categoryId: z.uuid().optional(),
    vendorId: z.uuid().optional(),
    contractId: z.uuid().optional(),
    name: z.string().trim().min(1).max(120),
    version: policyVersionInput,
  })
  .strict();

export function createPoliciesService(db: Database) {
  async function insertVersion(tx: Executor, ctx: CompanyCtx, policyId: string, scope: string, input: z.infer<typeof policyVersionInput>) {
    if (input.matrix.length > 0 && scope !== "COMPANY") {
      throw new AppError(400, "MATRIX_SCOPE", "La matriz de aprobación se define en la política empresarial (P0)");
    }
    const [{ next }] = (await tx
      .select({ next: sql<number>`coalesce(max(${policyVersions.versionNo}), 0) + 1` })
      .from(policyVersions)
      .where(eq(policyVersions.policyId, policyId))) as [{ next: number }];
    const [pv] = await tx
      .insert(policyVersions)
      .values({
        companyId: ctx.companyId,
        policyId,
        versionNo: Number(next),
        effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : sql`now()`,
        autoApprovalLimitBase: input.autoApprovalLimitBase ?? null,
        hardInvoiceCapBase: input.hardInvoiceCapBase ?? null,
        publishedByUserId: ctx.actor.kind === "USER" ? ctx.actor.ref : null,
      })
      .returning();
    if (input.matrix.length > 0) {
      await tx.insert(approvalMatrixRules).values(
        input.matrix.map((m) => ({ companyId: ctx.companyId, policyVersionId: pv!.id, minAmountExclusive: m.minAmountExclusive, maxAmountInclusive: m.maxAmountInclusive ?? null, personaId: m.personaId })),
      );
    }
    await recordAudit(tx, { companyId: ctx.companyId, actor: ctx.actor, eventType: "policy_version.published", entityType: "policy", entityRef: policyId, details: { versionId: pv!.id, versionNo: pv!.versionNo, autoApprovalLimitBase: pv!.autoApprovalLimitBase, hardInvoiceCapBase: pv!.hardInvoiceCapBase, matrixRules: input.matrix.length } });
    return pv!;
  }

  async function detail(ctx: CompanyCtx, policyId: string) {
    const [policy] = await db.select().from(companyPolicies).where(and(eq(companyPolicies.id, policyId), eq(companyPolicies.companyId, ctx.companyId)));
    if (!policy) throw notFound("Política no encontrada");
    const versions = await db.select().from(policyVersions).where(eq(policyVersions.policyId, policyId)).orderBy(desc(policyVersions.versionNo));
    const matrix = versions.length ? await db.select().from(approvalMatrixRules).where(inArray(approvalMatrixRules.policyVersionId, versions.map((v) => v.id))).orderBy(asc(approvalMatrixRules.minAmountExclusive)) : [];
    return { policy, versions: versions.map((v) => ({ ...v, matrix: matrix.filter((m) => m.policyVersionId === v.id) })) };
  }

  return {
    detail,
    list: (ctx: CompanyCtx) => db.select().from(companyPolicies).where(eq(companyPolicies.companyId, ctx.companyId)).orderBy(asc(companyPolicies.scopeLevel), asc(companyPolicies.name)),

    async create(ctx: CompanyCtx, body: z.infer<typeof policyCreateBody>) {
      const id = await db.transaction(async (tx) => {
        const [p] = await tx
          .insert(companyPolicies)
          .values({ companyId: ctx.companyId, scopeLevel: body.scopeLevel, categoryId: body.categoryId ?? null, vendorId: body.vendorId ?? null, contractId: body.contractId ?? null, name: body.name })
          .returning();
        await recordAudit(tx, { companyId: ctx.companyId, actor: ctx.actor, eventType: "policy.created", entityType: "policy", entityRef: p!.id, details: { scopeLevel: p!.scopeLevel } });
        await insertVersion(tx, ctx, p!.id, p!.scopeLevel, body.version);
        return p!.id;
      });
      return detail(ctx, id);
    },

    /** Nueva versión inmutable; las anteriores se conservan para auditoría. */
    async addVersion(ctx: CompanyCtx, policyId: string, input: z.infer<typeof policyVersionInput>) {
      await db.transaction(async (tx) => {
        const [p] = await tx.select().from(companyPolicies).where(and(eq(companyPolicies.id, policyId), eq(companyPolicies.companyId, ctx.companyId))).for("update");
        if (!p) throw notFound("Política no encontrada");
        await insertVersion(tx, ctx, policyId, p.scopeLevel, input);
      });
      return detail(ctx, policyId);
    },

    async setActive(ctx: CompanyCtx, policyId: string, active: boolean) {
      await db.transaction(async (tx) => {
        const [p] = await tx.update(companyPolicies).set({ active }).where(and(eq(companyPolicies.id, policyId), eq(companyPolicies.companyId, ctx.companyId))).returning();
        if (!p) throw notFound("Política no encontrada");
        await recordAudit(tx, { companyId: ctx.companyId, actor: ctx.actor, eventType: active ? "policy.activated" : "policy.deactivated", entityType: "policy", entityRef: policyId });
      });
      return detail(ctx, policyId);
    },
  };
}

export type PoliciesService = ReturnType<typeof createPoliciesService>;
