import { Router } from "express";
import { z } from "zod";
import { ctxOf, idParam } from "../../shared/http/context.js";
import { policyCreateBody, policyVersionInput, type PoliciesService } from "./policies.service.js";

export function policiesRouter(service: PoliciesService): Router {
  const router = Router();
  router.get("/policies", async (req, res) => {
    res.json({ policies: await service.list(ctxOf(req)) });
  });
  router.post("/policies", async (req, res) => {
    res.status(201).json(await service.create(ctxOf(req), policyCreateBody.parse(req.body)));
  });
  router.get("/policies/:id", async (req, res) => {
    res.json(await service.detail(ctxOf(req), idParam(req, "id")));
  });
  router.post("/policies/:id/versions", async (req, res) => {
    res.status(201).json(await service.addVersion(ctxOf(req), idParam(req, "id"), policyVersionInput.parse(req.body)));
  });
  router.post("/policies/:id/active", async (req, res) => {
    const { active } = z.object({ active: z.boolean() }).strict().parse(req.body);
    res.json(await service.setActive(ctxOf(req), idParam(req, "id"), active));
  });
  return router;
}
