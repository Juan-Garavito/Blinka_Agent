import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../shared/db/client.js";
import { AppError, notFound } from "../../shared/errors/app-error.js";
import type { CompanyCtx } from "../../shared/http/context.js";
import { currencyString, isoDate, positiveMoneyString, quantityString, unitPriceString } from "../../shared/money.js";
import { recordAudit, type Executor } from "../audit/audit.service.js";
import { expenseCategories } from "../company-config/company-config.schema.js";
import { documents } from "../documents/documents.schema.js";
import { vendors } from "../vendors/vendors.schema.js";
import { BILLING_FREQUENCIES, BILLING_TYPES, contractItems, contracts, contractVersions, type BillingType, type ContractVersionOrigin } from "./contracts.schema.js";

const itemCode = z.string().trim().regex(/^[A-Za-z0-9._-]{1,40}$/);
const description = z.string().trim().min(1).max(300);

const fixedFeeItem = z.object({ kind: z.literal("FIXED_FEE"), code: itemCode, description, agreedAmount: positiveMoneyString }).strict();
const hourlyItem = z
  .object({ kind: z.literal("HOURLY_RATE"), code: itemCode, description, unit: z.enum(["HOUR"]).default("HOUR"), unitPrice: unitPriceString })
  .strict();
const milestoneItem = z
  .object({ kind: z.literal("MILESTONE"), code: itemCode, description, milestoneRef: z.string().trim().min(1).max(80), agreedAmount: positiveMoneyString })
  .strict();
const poLineItem = z
  .object({
    kind: z.literal("PO_LINE"),
    code: itemCode,
    description,
    unit: z.string().trim().min(1).max(20).optional(),
    agreedQuantity: quantityString,
    unitPrice: unitPriceString,
  })
  .strict();

const versionBase = {
  currency: currencyString,
  effectiveFrom: isoDate,
  effectiveTo: isoDate.optional(),
  sourceDocumentId: z.uuid().optional(),
};

/** Validadores tipados por modalidad (ER §B): no todos los campos aplican a todos los tipos. */
export const versionInputByType = {
  RECURRING: z
    .object({
      ...versionBase,
      billingFrequency: z.enum(BILLING_FREQUENCIES),
      fixedPeriodAmount: positiveMoneyString,
      items: z.array(fixedFeeItem).max(50).default([]),
    })
    .strict(),
  HOURLY: z
    .object({
      ...versionBase,
      billingFrequency: z.enum(BILLING_FREQUENCIES).optional(),
      quantityCapPerPeriod: quantityString.optional(),
      items: z.array(hourlyItem).min(1).max(50),
    })
    .strict()
    .refine((v) => !v.quantityCapPerPeriod || v.billingFrequency, { error: "quantityCapPerPeriod requiere billingFrequency", path: ["billingFrequency"] }),
  MILESTONE: z.object({ ...versionBase, items: z.array(milestoneItem).min(1).max(100) }).strict(),
  PURCHASE_ORDER: z.object({ ...versionBase, items: z.array(poLineItem).min(1).max(200) }).strict(),
} as const;

export type VersionInput = z.infer<(typeof versionInputByType)[BillingType]>;

export function parseVersionInput(billingType: BillingType, raw: unknown): VersionInput {
  const v = versionInputByType[billingType].parse(raw);
  if (v.effectiveTo && v.effectiveTo < v.effectiveFrom) {
    throw new AppError(400, "VALIDATION_ERROR", "effectiveTo no puede ser anterior a effectiveFrom");
  }
  const codes = v.items.map((i) => i.code);
  if (new Set(codes).size !== codes.length) throw new AppError(400, "VALIDATION_ERROR", "Códigos de ítem duplicados");
  return v;
}

export const contractCreateBody = z
  .object({
    vendorId: z.uuid(),
    categoryId: z.uuid(),
    contractRef: z.string().trim().min(1).max(80),
    billingType: z.enum(BILLING_TYPES),
    version: z.unknown(),
    /** true: la persona autenticada confirma las condiciones en el mismo acto. */
    confirm: z.boolean().default(false),
  })
  .strict();
export const versionCreateBody = z.object({ version: z.unknown(), confirm: z.boolean().default(false) }).strict();

export function createContractsService(db: Database) {
  async function getContract(ctx: CompanyCtx, id: string) {
    const [c] = await db.select().from(contracts).where(and(eq(contracts.id, id), eq(contracts.companyId, ctx.companyId))).limit(1);
    if (!c) throw notFound("Contrato no encontrado");
    return c;
  }

  async function assertDocument(exec: Executor, ctx: CompanyCtx, documentId: string | undefined) {
    if (!documentId) return;
    const [d] = await exec
      .select({ kind: documents.kind })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.companyId, ctx.companyId)))
      .limit(1);
    if (!d) throw notFound("Documento no encontrado");
    if (d.kind !== "CONTRACT") throw new AppError(400, "INVALID_DOCUMENT_KIND", "El documento fuente debe ser de tipo CONTRACT");
  }

  /** Inserta versión + ítems en DRAFT y, si procede, la confirma (ítems ya no modificables). */
  async function insertVersion(
    tx: Executor,
    ctx: CompanyCtx,
    contractId: string,
    input: VersionInput,
    opts: { origin: ContractVersionOrigin; confirm: boolean },
  ) {
    await assertDocument(tx, ctx, input.sourceDocumentId);
    const [{ next }] = (await tx
      .select({ next: sql<number>`coalesce(max(${contractVersions.versionNo}), 0) + 1` })
      .from(contractVersions)
      .where(eq(contractVersions.contractId, contractId))) as [{ next: number }];
    const [version] = await tx
      .insert(contractVersions)
      .values({
        companyId: ctx.companyId,
        contractId,
        versionNo: Number(next),
        currency: input.currency,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        billingFrequency: "billingFrequency" in input ? (input.billingFrequency ?? null) : null,
        fixedPeriodAmount: "fixedPeriodAmount" in input ? input.fixedPeriodAmount : null,
        quantityCapPerPeriod: "quantityCapPerPeriod" in input ? (input.quantityCapPerPeriod ?? null) : null,
        status: "DRAFT",
        origin: opts.origin,
        sourceDocumentId: input.sourceDocumentId ?? null,
      })
      .returning();
    if (input.items.length > 0) {
      await tx.insert(contractItems).values(
        input.items.map((i) => ({
          contractVersionId: version!.id,
          code: i.code,
          description: i.description,
          itemKind: i.kind,
          unit: "unit" in i ? (i.unit ?? null) : null,
          agreedQuantity: "agreedQuantity" in i ? i.agreedQuantity : null,
          unitPrice: "unitPrice" in i ? i.unitPrice : null,
          milestoneRef: "milestoneRef" in i ? i.milestoneRef : null,
          agreedAmount: "agreedAmount" in i ? i.agreedAmount : null,
        })),
      );
    }
    await recordAudit(tx, {
      companyId: ctx.companyId,
      actor: ctx.actor,
      eventType: "contract_version.created",
      entityType: "contract_version",
      entityRef: version!.id,
      details: { contractId, versionNo: version!.versionNo, origin: opts.origin },
    });
    if (opts.confirm) await confirm(tx, ctx, version!.id);
    return version!.id;
  }

  /** Solo una persona autenticada (actor USER) puede confirmar condiciones contractuales. */
  async function confirm(tx: Executor, ctx: CompanyCtx, versionId: string) {
    if (ctx.actor.kind !== "USER") throw new AppError(403, "HUMAN_CONFIRMATION_REQUIRED", "Solo una persona autenticada confirma contratos");
    const [row] = await tx
      .update(contractVersions)
      .set({ status: "CONFIRMED", confirmedByUserId: ctx.actor.ref, confirmedAt: new Date() })
      .where(and(eq(contractVersions.id, versionId), eq(contractVersions.companyId, ctx.companyId), eq(contractVersions.status, "DRAFT")))
      .returning({ id: contractVersions.id });
    if (!row) throw new AppError(409, "VERSION_NOT_DRAFT", "La versión no existe o ya no está en borrador");
    await recordAudit(tx, { companyId: ctx.companyId, actor: ctx.actor, eventType: "contract_version.confirmed", entityType: "contract_version", entityRef: versionId });
  }

  async function detail(ctx: CompanyCtx, contractId: string) {
    const contract = await getContract(ctx, contractId);
    const versions = await db
      .select()
      .from(contractVersions)
      .where(and(eq(contractVersions.contractId, contractId), eq(contractVersions.companyId, ctx.companyId)))
      .orderBy(desc(contractVersions.versionNo));
    const items = versions.length
      ? await db
          .select()
          .from(contractItems)
          .where(inArray(contractItems.contractVersionId, versions.map((v) => v.id)))
          .orderBy(asc(contractItems.code))
      : [];
    return { contract, versions: versions.map((v) => ({ ...v, items: items.filter((i) => i.contractVersionId === v.id) })) };
  }

  return {
    getContract,
    detail,

    list: (ctx: CompanyCtx, filter: { vendorId?: string }) =>
      db
        .select()
        .from(contracts)
        .where(and(eq(contracts.companyId, ctx.companyId), filter.vendorId ? eq(contracts.vendorId, filter.vendorId) : undefined))
        .orderBy(asc(contracts.contractRef)),

    async create(ctx: CompanyCtx, body: z.infer<typeof contractCreateBody>) {
      const version = parseVersionInput(body.billingType, body.version);
      const contractId = await db.transaction(async (tx) => {
        const [vendor] = await tx.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.id, body.vendorId), eq(vendors.companyId, ctx.companyId)));
        if (!vendor) throw notFound("Proveedor no encontrado");
        const [category] = await tx
          .select({ id: expenseCategories.id, active: expenseCategories.active })
          .from(expenseCategories)
          .where(and(eq(expenseCategories.id, body.categoryId), eq(expenseCategories.companyId, ctx.companyId)));
        if (!category) throw notFound("Categoría no encontrada");
        if (!category.active) throw new AppError(400, "CATEGORY_INACTIVE", "La categoría está inactiva");
        const [c] = await tx
          .insert(contracts)
          .values({ companyId: ctx.companyId, vendorId: body.vendorId, categoryId: body.categoryId, contractRef: body.contractRef, billingType: body.billingType })
          .returning();
        await recordAudit(tx, { companyId: ctx.companyId, actor: ctx.actor, eventType: "contract.created", entityType: "contract", entityRef: c!.id, details: { billingType: c!.billingType } });
        await insertVersion(tx, ctx, c!.id, version, { origin: "MANUAL", confirm: body.confirm });
        return c!.id;
      });
      return detail(ctx, contractId);
    },

    /** Nueva versión de condiciones. Bloquea el contrato para numerar versiones sin carreras. */
    async addVersion(ctx: CompanyCtx, contractId: string, body: z.infer<typeof versionCreateBody>, origin: ContractVersionOrigin = "MANUAL") {
      const contract = await getContract(ctx, contractId);
      const version = parseVersionInput(contract.billingType, body.version);
      await db.transaction(async (tx) => {
        await tx.select({ id: contracts.id }).from(contracts).where(eq(contracts.id, contractId)).for("update");
        // Una sugerencia de IA nunca se confirma en el mismo acto.
        await insertVersion(tx, ctx, contractId, version, { origin, confirm: origin === "MANUAL" && body.confirm });
      });
      return detail(ctx, contractId);
    },

    async confirmVersion(ctx: CompanyCtx, contractId: string, versionId: string) {
      await getContract(ctx, contractId);
      await db.transaction(async (tx) => {
        const [v] = await tx
          .select({ contractId: contractVersions.contractId })
          .from(contractVersions)
          .where(and(eq(contractVersions.id, versionId), eq(contractVersions.companyId, ctx.companyId)));
        if (!v || v.contractId !== contractId) throw notFound("Versión no encontrada");
        await confirm(tx, ctx, versionId);
      });
      return detail(ctx, contractId);
    },

    async rejectVersion(ctx: CompanyCtx, contractId: string, versionId: string, reason: string) {
      await getContract(ctx, contractId);
      await db.transaction(async (tx) => {
        const [row] = await tx
          .update(contractVersions)
          .set({ status: "REJECTED" })
          .where(
            and(
              eq(contractVersions.id, versionId),
              eq(contractVersions.contractId, contractId),
              eq(contractVersions.companyId, ctx.companyId),
              eq(contractVersions.status, "DRAFT"),
            ),
          )
          .returning({ id: contractVersions.id });
        if (!row) throw new AppError(409, "VERSION_NOT_DRAFT", "La versión no existe o ya no está en borrador");
        await recordAudit(tx, { companyId: ctx.companyId, actor: ctx.actor, eventType: "contract_version.rejected", entityType: "contract_version", entityRef: versionId, details: { reason } });
      });
      return detail(ctx, contractId);
    },
  };
}

export type ContractsService = ReturnType<typeof createContractsService>;
