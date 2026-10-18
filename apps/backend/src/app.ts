import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express, { type Express, type Router } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { Env } from "./config/env.js";
import type { Logger } from "./shared/logger.js";
import { errorHandler, notFoundHandler } from "./shared/errors/error-handler.js";
import { healthRouter, type HealthDeps } from "./modules/health/health.routes.js";
import { openApiDocument } from "./openapi.js";

export interface AppDeps extends HealthDeps {
  env: Pick<Env, "JSON_BODY_LIMIT" | "TRUST_PROXY">;
  logger: Logger;
  /** Router de negocio montado en /api (ver src/api.ts). */
  apiRouter?: Router;
  /** Build Vite opcional, servido desde el mismo origen que la API. */
  frontendDir?: string;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function createApp({ env, logger, checkDatabase, apiRouter, frontendDir }: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  // Nunca `true`: solo los saltos/IP declarados en TRUST_PROXY pueden fijar req.ip
  // a partir de X-Forwarded-For (ver config/env.ts).
  app.set("trust proxy", env.TRUST_PROXY);

  app.use(
    pinoHttp({
      logger,
      // Reutiliza un x-request-id entrante solo si tiene formato seguro.
      genReqId: (req, res) => {
        const incoming = req.headers["x-request-id"];
        const id = typeof incoming === "string" && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
        res.setHeader("x-request-id", id);
        return id;
      },
      // Sin cuerpos ni cabeceras completas en logs de acceso.
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
      autoLogging: { ignore: (req) => req.url === "/health" },
    }),
  );
  app.use(helmet());
  app.use(express.json({ limit: env.JSON_BODY_LIMIT }));

  app.use(healthRouter({ checkDatabase }));
  app.get("/openapi.json", (_req, res) => {
    res.json(openApiDocument);
  });

  if (apiRouter) app.use("/api", apiRouter);

  if (frontendDir) {
    const root = path.resolve(frontendDir);
    if (!existsSync(path.join(root, "index.html"))) throw new Error("Frontend build missing: run npm run build first");
    // Las rutas de API desconocidas conservan su 404 JSON, incluso al pedir HTML.
    app.use((req, res, next) => {
      if (/^\/(api|health|ready|openapi\.json)(\/|$)/.test(req.path)) return next();
      return express.static(root, { index: false, setHeaders: (response, file) => {
        response.setHeader("Cache-Control", file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
      } })(req, res, next);
    });
    app.get("/{*route}", (req, res, next) => {
      if (/^\/(api|health|ready|openapi\.json|assets)(\/|$)/.test(req.path) || path.extname(req.path) || !req.accepts("html")) return next();
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(root, "index.html"));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
