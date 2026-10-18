import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../shared/db/client.js";
import { normalizeEmail } from "./auth.service.js";
import { companies, companyUsers, users } from "./identity.schema.js";
import { hashPassword, verifyPassword } from "./password.js";

/** Identificador fijo (no secreto) de la empresa ficticia de demo: hace el seed idempotente. */
export const DEMO_COMPANY_ID = "0b1a0000-0000-4000-8000-000000000001";

const isIanaTimezone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const identitySeedInput = z.object({
  SEED_EVALUATOR_EMAIL: z.string().trim().pipe(z.email()),
  SEED_EVALUATOR_PASSWORD: z
    .string()
    .min(12, "mínimo 12 caracteres")
    .max(256)
    .refine((p) => !/^(change|cambia|password|contraseña)/i.test(p), { error: "usa una contraseña generada, no un marcador" }),
  SEED_COMPANY_NAME: z.string().trim().min(1).max(200).default("Blinka Demo Corp (ficticia)"),
  SEED_COMPANY_BASE_CURRENCY: z.string().regex(/^[A-Z]{3}$/).default("USD"),
  SEED_COMPANY_TIMEZONE: z.string().refine(isIanaTimezone, { error: "zona horaria IANA inválida" }).default("America/Bogota"),
});

export type IdentitySeedInput = z.infer<typeof identitySeedInput>;

export interface IdentitySeedResult {
  companyId: string;
  companyCreated: boolean;
  userId: string;
  userCreated: boolean;
  passwordUpdated: boolean;
  membershipCreated: boolean;
}

/**
 * Crea (o confirma) la empresa ficticia, el usuario evaluador y su membresía.
 * Re-ejecutarlo con los mismos valores no cambia nada. La contraseña solo se
 * re-hashea si la variable de entorno cambió. Una empresa existente nunca
 * cambia de moneda base (ER v1.2).
 */
export async function seedIdentity(db: Database, input: IdentitySeedInput): Promise<IdentitySeedResult> {
  return db.transaction(async (tx) => {
    const insertedCompany = await tx
      .insert(companies)
      .values({
        id: DEMO_COMPANY_ID,
        name: input.SEED_COMPANY_NAME,
        baseCurrency: input.SEED_COMPANY_BASE_CURRENCY,
        timezone: input.SEED_COMPANY_TIMEZONE,
      })
      .onConflictDoNothing({ target: companies.id })
      .returning({ id: companies.id });

    const email = normalizeEmail(input.SEED_EVALUATOR_EMAIL);
    const [existing] = await tx
      .select({ id: users.id, passwordHash: users.passwordHash, active: users.active })
      .from(users)
      .where(eq(users.email, email));

    let userId: string;
    let userCreated = false;
    let passwordUpdated = false;
    if (!existing) {
      const [created] = await tx
        .insert(users)
        .values({ email, passwordHash: await hashPassword(input.SEED_EVALUATOR_PASSWORD) })
        .returning({ id: users.id });
      userId = created!.id;
      userCreated = true;
    } else {
      userId = existing.id;
      if (!(await verifyPassword(existing.passwordHash, input.SEED_EVALUATOR_PASSWORD))) {
        await tx.update(users).set({ passwordHash: await hashPassword(input.SEED_EVALUATOR_PASSWORD) }).where(eq(users.id, userId));
        passwordUpdated = true;
      }
      if (!existing.active) await tx.update(users).set({ active: true }).where(eq(users.id, userId));
    }

    const insertedMembership = await tx
      .insert(companyUsers)
      .values({ companyId: DEMO_COMPANY_ID, userId })
      .onConflictDoNothing()
      .returning({ userId: companyUsers.userId });
    if (insertedMembership.length === 0) {
      await tx
        .update(companyUsers)
        .set({ active: true })
        .where(and(eq(companyUsers.companyId, DEMO_COMPANY_ID), eq(companyUsers.userId, userId), eq(companyUsers.active, false)));
    }

    return {
      companyId: DEMO_COMPANY_ID,
      companyCreated: insertedCompany.length > 0,
      userId,
      userCreated,
      passwordUpdated,
      membershipCreated: insertedMembership.length > 0,
    };
  });
}
