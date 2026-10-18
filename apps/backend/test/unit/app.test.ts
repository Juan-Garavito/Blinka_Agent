import express from "express";
import { pinoHttp } from "pino-http";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../../src/app.js";
import { AppError } from "../../src/shared/errors/app-error.js";
import { errorHandler, notFoundHandler } from "../../src/shared/errors/error-handler.js";
import { silentLogger } from "../helpers/env.js";

const appWith = (dbUp: boolean, limit = "1kb") =>
  createApp({ env: { JSON_BODY_LIMIT: limit, TRUST_PROXY: false }, logger: silentLogger, checkDatabase: () => Promise.resolve(dbUp) });

describe("health / readiness", () => {
  it("GET /health responde 200 aunque PostgreSQL esté caído", async () => {
    const res = await request(appWith(false)).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("GET /ready responde 200 con PostgreSQL disponible", async () => {
    const res = await request(appWith(true)).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ready", checks: { database: "up" } });
  });

  it("GET /ready responde 503 sin detalles internos con PostgreSQL caído", async () => {
    const res = await request(appWith(false)).get("/ready");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "not_ready", checks: { database: "down" } });
  });

  it("añade cabeceras de seguridad y oculta x-powered-by", async () => {
    const res = await request(appWith(true)).get("/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("propaga un x-request-id seguro y reemplaza uno inválido", async () => {
    const ok = await request(appWith(true)).get("/health").set("x-request-id", "abc-123");
    expect(ok.headers["x-request-id"]).toBe("abc-123");
    const bad = await request(appWith(true)).get("/health").set("x-request-id", "<script>");
    expect(bad.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("manejo centralizado de errores", () => {
  it("404 con formato estándar", async () => {
    const res = await request(appWith(true)).get("/no-existe");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: "NOT_FOUND" });
    expect(res.body.error.requestId).toBe(res.headers["x-request-id"]);
  });

  it("JSON mal formado → 400 MALFORMED_JSON", async () => {
    const res = await request(appWith(true)).post("/health").set("content-type", "application/json").send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MALFORMED_JSON");
  });

  it("payload mayor que el límite → 413", async () => {
    const res = await request(appWith(true, "1kb")).post("/health").send({ data: "x".repeat(2048) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  const mini = () => {
    const app = express();
    app.use(pinoHttp({ logger: silentLogger }));
    app.get("/zod", () => {
      z.object({ amount: z.string() }).parse({ amount: 1 });
    });
    app.get("/app", () => {
      throw new AppError(409, "CONFLICT", "Conflicto controlado");
    });
    app.get("/boom", async () => {
      await Promise.resolve();
      throw new Error("detalle interno con secreto");
    });
    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
  };

  it("ZodError → 400 VALIDATION_ERROR con detalles", async () => {
    const res = await request(mini()).get("/zod");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details[0].path).toBe("amount");
  });

  it("AppError conserva estado y código", async () => {
    const res = await request(mini()).get("/app");
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "CONFLICT", message: "Conflicto controlado" });
  });

  it("errores inesperados (también async) → 500 sin filtrar el mensaje interno", async () => {
    const res = await request(mini()).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body.error).toMatchObject({ code: "INTERNAL_ERROR", message: "Error interno" });
    expect(JSON.stringify(res.body)).not.toContain("secreto");
  });
});
