import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError, notFound } from "./app-error.js";
import { pgErrorOf } from "./pg-error.js";

interface ErrorBody {
  error: { code: string; message: string; requestId?: string; details?: unknown };
}

/** Errores lanzados por body-parser (express.json). */
function fromBodyParser(err: unknown): AppError | undefined {
  if (typeof err !== "object" || err === null || !("type" in err)) return undefined;
  switch (err.type) {
    case "entity.too.large":
      return new AppError(413, "PAYLOAD_TOO_LARGE", "El cuerpo de la petición excede el límite permitido");
    case "entity.parse.failed":
      return new AppError(400, "MALFORMED_JSON", "El cuerpo no es JSON válido");
    case "encoding.unsupported":
    case "charset.unsupported":
      return new AppError(415, "UNSUPPORTED_ENCODING", "Codificación no soportada");
    default:
      return undefined;
  }
}

/**
 * Violaciones de integridad de PostgreSQL → respuesta controlada. Solo se
 * expone el nombre de la restricción (nunca valores ni el detalle del error).
 * Son la última línea de defensa: los servicios validan antes.
 */
function fromPostgres(err: unknown): AppError | undefined {
  const pg = pgErrorOf(err);
  if (!pg) return undefined;
  const details = pg.constraint ? { constraint: pg.constraint } : undefined;
  switch (pg.code) {
    case "23505":
      return new AppError(409, "CONFLICT", "Ya existe un registro con esos datos", { details, cause: err });
    case "23P01":
      return new AppError(409, "CONFLICT", "El registro se solapa con otro existente", { details, cause: err });
    case "23001":
      return new AppError(409, "IMMUTABLE_RECORD", "El registro es inmutable", { details, cause: err });
    case "23503":
      return new AppError(400, "INVALID_REFERENCE", "Referencia inexistente o de otra empresa", { details, cause: err });
    case "23514":
    case "23502":
    case "22P02":
      return new AppError(400, "CONSTRAINT_VIOLATION", "Los datos no cumplen las restricciones", { details, cause: err });
    default:
      return undefined;
  }
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    return new AppError(400, "VALIDATION_ERROR", "Datos de entrada inválidos", {
      details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return (
    fromBodyParser(err) ??
    fromPostgres(err) ??
    new AppError(500, "INTERNAL_ERROR", "Error interno", { expose: false, cause: err })
  );
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(notFound(`Ruta no encontrada: ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const appError = toAppError(err);

  if (appError.statusCode >= 500) {
    req.log.error({ err }, "Error no controlado");
  } else {
    req.log.warn({ code: appError.code, status: appError.statusCode }, appError.message);
  }

  const body: ErrorBody = {
    error: {
      code: appError.code,
      message: appError.expose ? appError.message : "Error interno",
      requestId: typeof req.id === "object" ? undefined : String(req.id),
      ...(appError.expose && appError.details !== undefined ? { details: appError.details } : {}),
    },
  };
  res.status(appError.statusCode).json(body);
};
