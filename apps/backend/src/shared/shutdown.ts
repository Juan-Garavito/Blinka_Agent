import type { Logger } from "./logger.js";

/**
 * Cierre ordenado ante SIGTERM/SIGINT: ejecuta los pasos en secuencia y fuerza
 * la salida si superan `timeoutMs`. Una segunda señal no reinicia el proceso.
 */
export function onShutdown(logger: Logger, timeoutMs: number, steps: Array<() => Promise<void>>): void {
  let shuttingDown = false;
  const handler = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Cierre ordenado iniciado");
    const force = setTimeout(() => {
      logger.error({ timeoutMs }, "Cierre forzado por tiempo excedido");
      process.exit(1);
    }, timeoutMs);
    force.unref();

    void (async () => {
      let failed = false;
      for (const step of steps) {
        try {
          await step();
        } catch (err) {
          failed = true;
          logger.error({ err }, "Error durante el cierre");
        }
      }
      logger.info("Cierre completado");
      process.exitCode = failed ? 1 : 0;
      logger.flush();
    })();
  };
  process.once("SIGTERM", handler);
  process.once("SIGINT", handler);
}
