import { Router } from "express";

export interface HealthDeps {
  /** Devuelve true si PostgreSQL responde. No debe lanzar. */
  checkDatabase: () => Promise<boolean>;
}

/**
 * Endpoints técnicos:
 * - GET /health (liveness): solo indica que el proceso responde; no consulta dependencias.
 * - GET /ready (readiness): verifica PostgreSQL; 503 si no está disponible.
 * Ninguno expone detalles de conexión ni mensajes de error internos.
 */
export function healthRouter({ checkDatabase }: HealthDeps): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.set("Cache-Control", "no-store").json({ status: "ok" });
  });

  router.get("/ready", async (_req, res) => {
    const dbUp = await checkDatabase();
    res
      .status(dbUp ? 200 : 503)
      .set("Cache-Control", "no-store")
      .json({ status: dbUp ? "ready" : "not_ready", checks: { database: dbUp ? "up" : "down" } });
  });

  return router;
}
