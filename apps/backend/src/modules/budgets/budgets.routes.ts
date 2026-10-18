import { Router } from "express";
import { z } from "zod";
import { ctxOf } from "../../shared/http/context.js";
import { budgetUpsertBody, periodString, type BudgetsService } from "./budgets.service.js";

export function budgetsRouter(service: BudgetsService): Router {
  const router = Router();
  router.get("/budgets", async (req, res) => {
    const { period } = z.object({ period: periodString }).parse(req.query);
    res.json({ period, budgets: await service.list(ctxOf(req), period) });
  });
  router.get("/budgets/reservations", async (req, res) => {
    const { period } = z.object({ period: periodString }).parse(req.query);
    res.json({ period, reservations: await service.reservations(ctxOf(req), period), simulated: true });
  });
  router.put("/budgets", async (req, res) => {
    res.json({ budget: await service.upsert(ctxOf(req), budgetUpsertBody.parse(req.body)) });
  });
  return router;
}
