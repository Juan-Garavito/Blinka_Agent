import type { Database } from "../../shared/db/client.js";
import { auditEvents, type ActorKind } from "./audit.schema.js";

/** Ejecutor de consultas: la BD o una transacción en curso. */
export type Executor = Pick<Database, "insert" | "select" | "selectDistinct" | "update" | "delete" | "execute">;

export interface Actor {
  kind: ActorKind;
  ref: string;
}

export const userActor = (userId: string): Actor => ({ kind: "USER", ref: userId });
export const systemActor = (process: string): Actor => ({ kind: "SYSTEM", ref: process });

export interface AuditInput {
  companyId: string;
  actor: Actor;
  eventType: string;
  entityType: string;
  entityRef: string;
  details?: Record<string, unknown>;
}

/**
 * Registra un evento de auditoría. Debe llamarse con el mismo ejecutor
 * (transacción) que la operación auditada para que ambos confirmen o fallen juntos.
 */
export async function recordAudit(exec: Executor, input: AuditInput): Promise<void> {
  await exec.insert(auditEvents).values({
    companyId: input.companyId,
    actorKind: input.actor.kind,
    actorRef: input.actor.ref,
    eventType: input.eventType,
    entityType: input.entityType,
    entityRef: input.entityRef,
    details: input.details ?? null,
  });
}
