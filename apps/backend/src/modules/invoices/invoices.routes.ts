import { Router } from "express";
import { ctxOf, idParam } from "../../shared/http/context.js";
import { attachmentBody, confirmationBody, invoiceCreateBody, invoiceListQuery, invoiceVersionBody, type InvoicesService } from "./invoices.service.js";

export function invoicesRouter(service: InvoicesService): Router {
  const router = Router();
  router.get("/invoices", async (req, res) => {
    res.json(await service.list(ctxOf(req), invoiceListQuery.parse(req.query)));
  });
  router.post("/invoices", async (req, res) => {
    res.status(201).json(await service.create(ctxOf(req), invoiceCreateBody.parse(req.body)));
  });
  router.get("/invoices/:id", async (req, res) => {
    res.json(await service.detail(ctxOf(req), idParam(req, "id")));
  });
  router.post("/invoices/:id/versions", async (req, res) => {
    res.status(201).json(await service.addVersion(ctxOf(req), idParam(req, "id"), invoiceVersionBody.parse(req.body)));
  });
  router.post("/invoices/:id/attachments", async (req, res) => {
    res.status(201).json({ attachment: await service.addAttachment(ctxOf(req), idParam(req, "id"), attachmentBody.parse(req.body)) });
  });
  router.post("/invoices/:id/versions/:versionId/confirmations", async (req, res) => {
    res.status(201).json(await service.confirmFields(ctxOf(req), idParam(req, "id"), idParam(req, "versionId"), confirmationBody.parse(req.body)));
  });
  router.get("/invoices/:id/attachments", async (req, res) => {
    const ctx = ctxOf(req);
    const id = idParam(req, "id");
    await service.getInvoice(ctx, id);
    res.json({ attachments: await service.listAttachments(ctx, id) });
  });
  return router;
}
