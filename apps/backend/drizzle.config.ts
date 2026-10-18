import { defineConfig } from "drizzle-kit";

/**
 * Solo se usa para `drizzle-kit generate` (genera SQL versionado en ./drizzle,
 * sin conectar a ninguna base). Las migraciones se aplican con `npm run db:migrate`,
 * que pasa por la guardia de destino. No usar `drizzle-kit push` ni `migrate`.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/shared/db/schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
});
