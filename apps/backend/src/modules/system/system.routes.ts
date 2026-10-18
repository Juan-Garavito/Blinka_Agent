import { Router } from "express";
import type { AIProvider } from "../../agents/ai/types.js";
import type { DocumentStorage } from "../documents/storage.js";
import type { FxProvider } from "../fx/fx.providers.js";

/**
 * Qué servicios están activos y si son REALES o SIMULADOS, para que la UI lo
 * rotule (p. ej. «IA simulada» / «tipo de cambio simulado»). Sin secretos.
 */
export function systemRouter(deps: { aiProvider: AIProvider; fxProvider: FxProvider; storage: DocumentStorage }): Router {
  const router = Router();
  router.get("/system/environment", (_req, res) => {
    res.set("Cache-Control", "no-store").json({
      ai: { provider: deps.aiProvider.name, model: deps.aiProvider.model, simulated: deps.aiProvider.isSimulated },
      fx: { provider: deps.fxProvider.name, simulated: deps.fxProvider.isSimulated },
      storage: { driver: deps.storage.driver },
      payments: { real: false, note: "Autorizaciones y reservas simuladas; no se ejecutan pagos." },
    });
  });
  return router;
}
