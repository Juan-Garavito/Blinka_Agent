import { Router } from "express";
import { z } from "zod";
import { ctxOf, idParam } from "../../shared/http/context.js";
import type { EvaluationService } from "./evaluation.service.js";

const evaluateBody = z.object({ justification: z.string().trim().min(3).max(500).optional() }).strict();

export function evaluationsRouter(service: EvaluationService): Router {
  const router = Router();
  /** Evaluación determinista síncrona sobre los datos registrados (sin IA). */
  router.post("/invoices/:id/evaluations", async (req, res) => {
    const ctx = ctxOf(req);
    const body = evaluateBody.parse(req.body ?? {});
    const result = await service.evaluate(ctx.companyId, idParam(req, "id"), { trigger: "MANUAL", actor: ctx.actor, ...(body.justification ? { justification: body.justification } : {}) });
    res.status(201).json({ evaluation: result, simulated: true });
  });
  router.get("/invoices/:id/evaluations", async (req, res) => {
    res.json(await service.history(ctxOf(req).companyId, idParam(req, "id")));
  });
  return router;
}
