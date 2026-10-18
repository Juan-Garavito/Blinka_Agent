/**
 * Error de aplicación con código estable para el cliente.
 * Solo `message` de errores con `expose: true` llega a la respuesta HTTP.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly expose: boolean;
  readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: { expose?: boolean; details?: unknown; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.expose = options.expose ?? statusCode < 500;
    this.details = options.details;
  }
}

export const notFound = (message = "Recurso no encontrado") =>
  new AppError(404, "NOT_FOUND", message);

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, "BAD_REQUEST", message, { details });

export const serviceUnavailable = (message = "Servicio no disponible") =>
  new AppError(503, "SERVICE_UNAVAILABLE", message);
