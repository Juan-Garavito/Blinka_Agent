import { defineConfig } from "vitest/config";

/** Pruebas contra servicios externos reales (red). Separadas de `npm test`. */
export default defineConfig({
  test: { include: ["test/external/**/*.external.test.ts"], environment: "node", testTimeout: 30000 },
});
