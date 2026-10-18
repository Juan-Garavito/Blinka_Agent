import { sql } from "drizzle-orm";
import { boolean, char, check, index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Módulo Companies/Users (ER v1.2, grupo A) + sesiones de autenticación.
 * Las restricciones viven en la BD: la aplicación valida, la BD garantiza.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const COMPANY_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** ISO 4217 en mayúsculas. Moneda base de presupuestos y reservas. */
    baseCurrency: char("base_currency", { length: 3 }).notNull(),
    /** Zona IANA; determina el mes presupuestario local (ARCH-012). Validada por trigger. */
    timezone: text("timezone").notNull(),
    status: text("status").$type<CompanyStatus>().notNull().default("ACTIVE"),
    ...timestamps,
  },
  (t) => [
    check("companies_name_not_blank", sql`btrim(${t.name}) <> ''`),
    check("companies_base_currency_iso4217", sql`${t.baseCurrency} ~ '^[A-Z]{3}$'`),
    check("companies_status_valid", sql`${t.status} in ('ACTIVE', 'INACTIVE')`),
  ],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Siempre normalizado (minúsculas, sin espacios). */
    email: text("email").notNull(),
    /** Cadena PHC de Argon2id. Nunca la contraseña en claro. */
    passwordHash: text("password_hash").notNull(),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_email_key").on(t.email),
    check("users_email_normalized", sql`${t.email} = lower(btrim(${t.email})) and ${t.email} like '_%@_%'`),
    check("users_password_hash_argon2id", sql`${t.passwordHash} like '$argon2id$%'`),
  ],
);

/** Membresía usuario ↔ empresa. La PK compuesta implementa UNIQUE(company_id, user_id) del ER. */
export const companyUsers = pgTable(
  "company_users",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [primaryKey({ name: "company_users_pkey", columns: [t.companyId, t.userId] }), index("company_users_user_id_idx").on(t.userId)],
);

export const SESSION_REVOKE_REASONS = ["LOGOUT", "REGENERATED"] as const;
export type SessionRevokeReason = (typeof SESSION_REVOKE_REASONS)[number];

/**
 * Sesiones de servidor. La cookie contiene un token aleatorio; aquí solo se
 * guarda su SHA-256, de modo que una lectura de la tabla no permite suplantar sesiones.
 */
export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: char("token_hash", { length: 64 }).notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Token sincronizador CSRF ligado a la sesión. */
    csrfToken: text("csrf_token").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    /** Expiración absoluta; la inactividad se evalúa con last_seen_at. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason").$type<SessionRevokeReason>(),
  },
  (t) => [
    uniqueIndex("auth_sessions_token_hash_key").on(t.tokenHash),
    index("auth_sessions_user_id_idx").on(t.userId),
    index("auth_sessions_expires_at_idx").on(t.expiresAt),
    check("auth_sessions_token_hash_hex", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("auth_sessions_expiry_after_creation", sql`${t.expiresAt} > ${t.createdAt}`),
    check(
      "auth_sessions_revocation_consistent",
      // coalesce: un CHECK que evalúa a NULL se considera satisfecho en PostgreSQL.
      sql`(${t.revokedAt} is null and ${t.revokedReason} is null) or (${t.revokedAt} is not null and coalesce(${t.revokedReason} in ('LOGOUT', 'REGENERATED'), false))`,
    ),
  ],
);
