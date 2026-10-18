import { Router } from "express";
import { ctxOf, idParam } from "../../shared/http/context.js";
import { bankAccountInput, statusChange, vendorInput, vendorPatch, type VendorsService } from "./vendors.service.js";

export function vendorsRouter(service: VendorsService): Router {
  const router = Router();
  router.get("/vendors", async (req, res) => {
    res.json({ vendors: await service.list(ctxOf(req)) });
  });
  router.post("/vendors", async (req, res) => {
    res.status(201).json({ vendor: await service.create(ctxOf(req), vendorInput.parse(req.body)) });
  });
  router.get("/vendors/:id", async (req, res) => {
    const ctx = ctxOf(req);
    const id = idParam(req, "id");
    res.json({ vendor: await service.getVendor(ctx, id), bankAccounts: await service.listAccounts(ctx, id) });
  });
  router.patch("/vendors/:id", async (req, res) => {
    res.json({ vendor: await service.update(ctxOf(req), idParam(req, "id"), vendorPatch.parse(req.body)) });
  });
  router.post("/vendors/:id/status", async (req, res) => {
    res.json({ vendor: await service.setStatus(ctxOf(req), idParam(req, "id"), statusChange.parse(req.body)) });
  });
  router.get("/vendors/:id/bank-accounts", async (req, res) => {
    res.json({ bankAccounts: await service.listAccounts(ctxOf(req), idParam(req, "id")) });
  });
  router.post("/vendors/:id/bank-accounts", async (req, res) => {
    res.status(201).json({ bankAccount: await service.addAccount(ctxOf(req), idParam(req, "id"), bankAccountInput.parse(req.body)) });
  });
  router.post("/vendors/:id/bank-accounts/:accountId/status", async (req, res) => {
    res.json({
      bankAccount: await service.setAccountStatus(ctxOf(req), idParam(req, "id"), idParam(req, "accountId"), statusChange.parse(req.body)),
    });
  });
  return router;
}
