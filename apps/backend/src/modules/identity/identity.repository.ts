import { and, asc, eq, isNull } from "drizzle-orm";
import type { Database } from "../../shared/db/client.js";
import { authSessions, companies, companyUsers, users, type SessionRevokeReason } from "./identity.schema.js";

export interface CompanySummary {
  id: string;
  name: string;
  baseCurrency: string;
  timezone: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  email: string;
  userActive: boolean;
  csrfToken: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

const companySummary = {
  id: companies.id,
  name: companies.name,
  baseCurrency: companies.baseCurrency,
  timezone: companies.timezone,
};

/** Membresía utilizable: membresía activa en empresa activa. */
const usableMembership = (userId: string) =>
  and(eq(companyUsers.userId, userId), eq(companyUsers.active, true), eq(companies.status, "ACTIVE"));

export function createIdentityRepository(db: Database) {
  return {
    async findUserByEmail(email: string) {
      const [row] = await db
        .select({ id: users.id, email: users.email, passwordHash: users.passwordHash, active: users.active })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      return row;
    },

    async updatePasswordHash(userId: string, passwordHash: string) {
      await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
    },

    /** Empresas a las que el usuario tiene acceso. Ordenadas para un resultado estable. */
    async listUsableCompanies(userId: string): Promise<CompanySummary[]> {
      return db
        .select(companySummary)
        .from(companyUsers)
        .innerJoin(companies, eq(companies.id, companyUsers.companyId))
        .where(usableMembership(userId))
        .orderBy(asc(companies.name), asc(companies.id));
    },

    /** La empresa solo se devuelve si existe una membresía utilizable del usuario. */
    async findUsableCompany(userId: string, companyId: string): Promise<CompanySummary | undefined> {
      const [row] = await db
        .select(companySummary)
        .from(companyUsers)
        .innerJoin(companies, eq(companies.id, companyUsers.companyId))
        .where(and(usableMembership(userId), eq(companyUsers.companyId, companyId)))
        .limit(1);
      return row;
    },

    async insertSession(values: {
      tokenHash: string;
      userId: string;
      csrfToken: string;
      userAgent: string | null;
      createdAt: Date;
      expiresAt: Date;
    }) {
      const [row] = await db
        .insert(authSessions)
        .values({ ...values, lastSeenAt: values.createdAt })
        .returning({ id: authSessions.id });
      return row!;
    },

    async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | undefined> {
      const [row] = await db
        .select({
          id: authSessions.id,
          userId: authSessions.userId,
          email: users.email,
          userActive: users.active,
          csrfToken: authSessions.csrfToken,
          createdAt: authSessions.createdAt,
          lastSeenAt: authSessions.lastSeenAt,
          expiresAt: authSessions.expiresAt,
          revokedAt: authSessions.revokedAt,
        })
        .from(authSessions)
        .innerJoin(users, eq(users.id, authSessions.userId))
        .where(eq(authSessions.tokenHash, tokenHash))
        .limit(1);
      return row;
    },

    async touchSession(sessionId: string, at: Date) {
      await db.update(authSessions).set({ lastSeenAt: at }).where(eq(authSessions.id, sessionId));
    },

    /** Idempotente: solo revoca sesiones aún no revocadas. */
    async revokeSession(sessionId: string, reason: SessionRevokeReason, at: Date) {
      await db
        .update(authSessions)
        .set({ revokedAt: at, revokedReason: reason })
        .where(and(eq(authSessions.id, sessionId), isNull(authSessions.revokedAt)));
    },
  };
}

export type IdentityRepository = ReturnType<typeof createIdentityRepository>;
