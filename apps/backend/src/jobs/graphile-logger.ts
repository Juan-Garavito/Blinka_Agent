import { Logger as GraphileLogger } from "graphile-worker";
import type { Logger } from "../shared/logger.js";

/** Redirige los logs internos de Graphile Worker al logger estructurado. */
export function toGraphileLogger(logger: Logger): GraphileLogger {
  return new GraphileLogger((scope) => {
    const child = logger.child({ worker: scope });
    return (level, message, meta) => {
      const method = level === "warning" ? "warn" : level;
      child[method](meta ?? {}, message);
    };
  });
}
