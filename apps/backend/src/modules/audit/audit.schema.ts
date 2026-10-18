import { sql } from "drizzle-orm";
import { check, foreignKey, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companyIdColumn } from "../../shared/db/columns.js";
import { companies } from "../identity/identity.schema.js";

export const ACTOR_KINDS = ["USER", "SYSTEM", "AGENT"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

/**
 * Registro append-only (ER v1.2 §H). Un trigger impide UPDATE y DELETE.
 * `details` solo lleva metadatos no críticos; las decisiones importantes
 * viven en sus tablas con FKs.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyIdColumn(),
    actorKind: text("actor_kind").$type<ActorKind>().notNull(),
    /** id de usuario, nombre de proceso o de especialista; nunca secretos. */
    actorRef: text("actor_ref").notNull(),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityRef: text("entity_ref").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    details: jsonb("details").$type<Record<string, unknown>>(),
  },
  (t) => [
    foreignKey({ name: "audit_events_company_fk", columns: [t.companyId], foreignColumns: [companies.id] }).onDelete("restrict"),
    index("audit_events_entity_idx").on(t.companyId, t.entityType, t.entityRef, t.occurredAt),
    index("audit_events_company_time_idx").on(t.companyId, t.occurredAt),
    check("audit_events_actor_kind_valid", sql`${t.actorKind} in ('USER', 'SYSTEM', 'AGENT')`),
    check("audit_events_event_type_format", sql`${t.eventType} ~ '^[a-z][a-z0-9_.]{2,80}$'`),
  ],
);
