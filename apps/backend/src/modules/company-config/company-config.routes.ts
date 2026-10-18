import { Router } from "express";
import { ctxOf, idParam } from "../../shared/http/context.js";
import { categoryInput, categoryPatch, personaInput, personaPatch, type CompanyConfigService } from "./company-config.service.js";

export function companyConfigRouter(service: CompanyConfigService): Router {
  const router = Router();
  router.get("/categories", async (req, res) => {
    res.json({ categories: await service.listCategories(ctxOf(req)) });
  });
  router.post("/categories", async (req, res) => {
    res.status(201).json({ category: await service.createCategory(ctxOf(req), categoryInput.parse(req.body)) });
  });
  router.patch("/categories/:id", async (req, res) => {
    res.json({ category: await service.updateCategory(ctxOf(req), idParam(req, "id"), categoryPatch.parse(req.body)) });
  });
  // Personas aprobadoras SIMULADAS: no son usuarios del sistema.
  router.get("/approval-personas", async (req, res) => {
    res.json({ personas: await service.listPersonas(ctxOf(req)), simulated: true });
  });
  router.post("/approval-personas", async (req, res) => {
    res.status(201).json({ persona: await service.createPersona(ctxOf(req), personaInput.parse(req.body)), simulated: true });
  });
  router.patch("/approval-personas/:id", async (req, res) => {
    res.json({ persona: await service.updatePersona(ctxOf(req), idParam(req, "id"), personaPatch.parse(req.body)), simulated: true });
  });
  return router;
}
