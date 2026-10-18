import { Router } from "express";
import { z } from "zod";
import { ctxOf, idParam } from "../../shared/http/context.js";
import { contractCreateBody, versionCreateBody, type ContractsService } from "./contracts.service.js";

const listQuery = z.object({ vendorId: z.uuid().optional() });
const rejectBody = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

export function contractsRouter(service: ContractsService): Router {
  const router = Router();
  router.get("/contracts", async (req, res) => {
    res.json({ contracts: await service.list(ctxOf(req), listQuery.parse(req.query)) });
  });
  router.post("/contracts", async (req, res) => {
    res.status(201).json(await service.create(ctxOf(req), contractCreateBody.parse(req.body)));
  });
  router.get("/contracts/:id", async (req, res) => {
    res.json(await service.detail(ctxOf(req), idParam(req, "id")));
  });
  router.post("/contracts/:id/versions", async (req, res) => {
    res.status(201).json(await service.addVersion(ctxOf(req), idParam(req, "id"), versionCreateBody.parse(req.body)));
  });
  router.post("/contracts/:id/versions/:versionId/confirm", async (req, res) => {
    res.json(await service.confirmVersion(ctxOf(req), idParam(req, "id"), idParam(req, "versionId")));
  });
  router.post("/contracts/:id/versions/:versionId/reject", async (req, res) => {
    const { reason } = rejectBody.parse(req.body);
    res.json(await service.rejectVersion(ctxOf(req), idParam(req, "id"), idParam(req, "versionId"), reason));
  });
  return router;
}
