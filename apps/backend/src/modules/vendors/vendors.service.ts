import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../shared/db/client.js";
import { notFound } from "../../shared/errors/app-error.js";
import type { CompanyCtx } from "../../shared/http/context.js";
import { recordAudit } from "../audit/audit.service.js";
import { accountFingerprint, accountMask, normalizeAccountNumber } from "./account-fingerprint.js";
import { VENDOR_STATUSES, vendorBankAccounts, vendors } from "./vendors.schema.js";

export const normalizeTaxReference = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");

const taxReference = z
  .string()
  .trim()
  .transform(normalizeTaxReference)
  .pipe(z.string().regex(/^[A-Z0-9]{3,40}$/, "identificación fiscal de 3 a 40 caracteres alfanuméricos"));

export const vendorInput = z.object({ legalName: z.string().trim().min(1).max(200), taxReference: taxReference.optional() }).strict();
export const vendorPatch = vendorInput.partial().strict();
/** Cambio de estado: solo por persona autenticada, con motivo obligatorio y auditado. */
export const statusChange = z.object({ status: z.enum(VENDOR_STATUSES), reason: z.string().trim().min(3).max(500) }).strict();
export const bankAccountInput = z
  .object({
    country: z.string().regex(/^[A-Z]{2}$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    accountNumber: z
      .string()
      .max(64)
      .transform(normalizeAccountNumber)
      .pipe(z.string().regex(/^[A-Z0-9]{6,34}$/, "número de cuenta/IBAN de 6 a 34 caracteres")),
  })
  .strict();

const publicAccount = (a: typeof vendorBankAccounts.$inferSelect) => ({
  id: a.id,
  vendorId: a.vendorId,
  country: a.country,
  currency: a.currency,
  accountMask: a.accountMask,
  status: a.status,
  createdAt: a.createdAt.toISOString(),
  updatedAt: a.updatedAt.toISOString(),
});

export function createVendorsService(deps: { db: Database; fingerprintSecret: string | undefined }) {
  const { db } = deps;

  async function getVendor(ctx: CompanyCtx, id: string) {
    const [v] = await db.select().from(vendors).where(and(eq(vendors.id, id), eq(vendors.companyId, ctx.companyId))).limit(1);
    if (!v) throw notFound("Proveedor no encontrado");
    return v;
  }

  return {
    getVendor,
    publicAccount,

    list: (ctx: CompanyCtx) => db.select().from(vendors).where(eq(vendors.companyId, ctx.companyId)).orderBy(asc(vendors.legalName)),

    async create(ctx: CompanyCtx, input: z.infer<typeof vendorInput>) {
      return db.transaction(async (tx) => {
        // Todo proveedor nuevo nace PENDING: requiere autorización explícita (BR-002).
        const [v] = await tx.insert(vendors).values({ companyId: ctx.companyId, ...input, status: "PENDING" }).returning();
        await recordAudit(tx, { companyId: ctx.companyId, actor: ctx.actor, eventType: "vendor.created", entityType: "vendor", entityRef: v!.id });
        return v!;
      });
    },

    async update(ctx: CompanyCtx, id: string, patch: z.infer<typeof vendorPatch>) {
      return db.transaction(async (tx) => {
        const [v] = await tx.update(vendors).set(patch).where(and(eq(vendors.id, id), eq(vendors.companyId, ctx.companyId))).returning();
        if (!v) throw notFound("Proveedor no encontrado");
        await recordAudit(tx, { companyId: ctx.companyId, actor: ctx.actor, eventType: "vendor.updated", entityType: "vendor", entityRef: id, details: { fields: Object.keys(patch) } });
        return v;
      });
    },

    async setStatus(ctx: CompanyCtx, id: string, change: z.infer<typeof statusChange>) {
      return db.transaction(async (tx) => {
        const [before] = await tx
          .select({ status: vendors.status })
          .from(vendors)
          .where(and(eq(vendors.id, id), eq(vendors.companyId, ctx.companyId)))
          .for("update");
        if (!before) throw notFound("Proveedor no encontrado");
        const [v] = await tx.update(vendors).set({ status: change.status }).where(eq(vendors.id, id)).returning();
        await recordAudit(tx, {
          companyId: ctx.companyId,
          actor: ctx.actor,
          eventType: "vendor.status_changed",
          entityType: "vendor",
          entityRef: id,
          details: { from: before.status, to: change.status, reason: change.reason },
        });
        return v!;
      });
    },

    async listAccounts(ctx: CompanyCtx, vendorId: string) {
      await getVendor(ctx, vendorId);
      const rows = await db
        .select()
        .from(vendorBankAccounts)
        .where(and(eq(vendorBankAccounts.companyId, ctx.companyId), eq(vendorBankAccounts.vendorId, vendorId)))
        .orderBy(asc(vendorBankAccounts.createdAt));
      return rows.map(publicAccount);
    },

    async addAccount(ctx: CompanyCtx, vendorId: string, input: z.infer<typeof bankAccountInput>) {
      await getVendor(ctx, vendorId);
      return db.transaction(async (tx) => {
        const [a] = await tx
          .insert(vendorBankAccounts)
          .values({
            companyId: ctx.companyId,
            vendorId,
            country: input.country,
            currency: input.currency,
            accountFingerprint: accountFingerprint(deps.fingerprintSecret, input.accountNumber),
            accountMask: accountMask(input.accountNumber),
            // Cada cuenta se autoriza por separado del proveedor.
            status: "PENDING",
          })
          .returning();
        await recordAudit(tx, {
          companyId: ctx.companyId,
          actor: ctx.actor,
          eventType: "vendor_bank_account.created",
          entityType: "vendor_bank_account",
          entityRef: a!.id,
          details: { vendorId, mask: a!.accountMask, country: a!.country, currency: a!.currency },
        });
        return publicAccount(a!);
      });
    },

    async setAccountStatus(ctx: CompanyCtx, vendorId: string, accountId: string, change: z.infer<typeof statusChange>) {
      return db.transaction(async (tx) => {
        const [before] = await tx
          .select({ status: vendorBankAccounts.status })
          .from(vendorBankAccounts)
          .where(and(eq(vendorBankAccounts.id, accountId), eq(vendorBankAccounts.vendorId, vendorId), eq(vendorBankAccounts.companyId, ctx.companyId)))
          .for("update");
        if (!before) throw notFound("Cuenta no encontrada");
        const [a] = await tx.update(vendorBankAccounts).set({ status: change.status }).where(eq(vendorBankAccounts.id, accountId)).returning();
        await recordAudit(tx, {
          companyId: ctx.companyId,
          actor: ctx.actor,
          eventType: "vendor_bank_account.status_changed",
          entityType: "vendor_bank_account",
          entityRef: accountId,
          details: { vendorId, from: before.status, to: change.status, reason: change.reason },
        });
        return publicAccount(a!);
      });
    },
  };
}

export type VendorsService = ReturnType<typeof createVendorsService>;
