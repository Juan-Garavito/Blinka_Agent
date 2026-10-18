import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Las pruebas contra servicios externos reales (red) se ejecutan aparte: `npm run test:external`.
    exclude: ["test/external/**", "**/node_modules/**"],
    environment: "node",
    // El registro de operaciones de las pruebas no se mezcla con el del operador.
    env: {
      OPS_AUDIT_FILE: path.join(tmpdir(), "blinka-test-ops-audit.jsonl"),
      // Clave HMAC efímera solo para pruebas (no es un secreto real).
      ACCOUNT_FINGERPRINT_SECRET: `test-only-${randomBytes(24).toString("hex")}`,
    },
    // Las pruebas de integración comparten la base de pruebas: ejecución secuencial de archivos.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
