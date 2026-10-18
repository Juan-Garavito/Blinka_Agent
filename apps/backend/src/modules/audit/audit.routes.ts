import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../shared/db/client.js";
import { ctxOf } from "../../shared/http/context.js";
import { aiUsageLogs } from "../../agents/ai-usage.schema.js";
import { auditEvents } from "./audit.schema.js";

const query = z.object({
  entityType: z.string().regex(/^[a-z_]{2,40}$/).optional(),
  entityRef: z.uuid().optional(),
  eventType: z.string().regex(/^[a-z][a-z0-9_.]{2,80}$/).optional(),
  actorKind: z.enum(["USER", "SYSTEM", "AGENT"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
const usageQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).max(100_000).default(0), evaluationRunId: z.uuid().optional() });

/** Lectura de la auditoría append-only de la empresa (sin secretos: solo metadatos). */
export function auditRouter(db: Database): Router {
  const router = Router();
  router.get("/audit-events", async (req, res) => {
    const ctx = ctxOf(req);
    const q = query.parse(req.query);
    const events = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.companyId, ctx.companyId),
          q.entityType ? eq(auditEvents.entityType, q.entityType) : undefined,
          q.entityRef ? eq(auditEvents.entityRef, q.entityRef) : undefined,
          q.eventType ? eq(auditEvents.eventType, q.eventType) : undefined,
          q.actorKind ? eq(auditEvents.actorKind, q.actorKind) : undefined,
        ),
      )
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(q.limit)
      .offset(q.offset);
    res.json({ events, limit: q.limit, offset: q.offset });
  });

  /** Consumo de IA por llamada (sin prompts ni documentos); `isSimulated` distingue FAKE (MOCK) de real. */
  router.get("/ai-usage", async (req, res) => {
    const ctx = ctxOf(req);
    const q = usageQuery.parse(req.query);
    const usage = await db
      .select()
      .from(aiUsageLogs)
      .where(and(eq(aiUsageLogs.companyId, ctx.companyId), q.evaluationRunId ? eq(aiUsageLogs.evaluationRunId, q.evaluationRunId) : undefined))
      .orderBy(desc(aiUsageLogs.createdAt))
      .limit(q.limit)
      .offset(q.offset);
    res.json({ usage, limit: q.limit, offset: q.offset });
  });
  return router;
}
