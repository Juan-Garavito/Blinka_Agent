import { Router } from "express";
import { ctxOf, idParam } from "../../shared/http/context.js";
import { listQuery, resolveBody, type ApprovalsService } from "./approvals.service.js";

/** Aprobaciones SIMULADAS: el evaluador registra la respuesta de una persona ficticia. */
export function approvalsRouter(service: ApprovalsService): Router {
  const router = Router();
  router.get("/approval-requests", async (req, res) => {
    const { status } = listQuery.parse(req.query);
    res.json({ approvalRequests: await service.list(ctxOf(req), status), simulated: true });
  });
  router.post("/approval-requests/:id/resolve", async (req, res) => {
    res.json(await service.resolve(ctxOf(req), idParam(req, "id"), resolveBody.parse(req.body)));
  });
  router.get("/invoices/:id/approval-requests", async (req, res) => {
    res.json({ approvalRequests: await service.forInvoice(ctxOf(req), idParam(req, "id")), simulated: true });
  });
  return router;
}
