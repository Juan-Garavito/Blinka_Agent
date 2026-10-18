import { getEnv } from "../../config/env.js";
import { seedDemo } from "../../modules/demo/demo.seed.js";
import { createDocumentStorage } from "../../modules/documents/storage-factory.js";
import { periodOf } from "../../modules/evaluations/decision-engine.js";
import { identitySeedInput, seedIdentity } from "../../modules/identity/identity.seed.js";
import { createLogger } from "../logger.js";
import { withProvisioningDb } from "./provisioning.js";
import { assertSeedTarget } from "./seed-guard.js";

/**
 * Seed de datos FICTICIOS: identidad (empresa + evaluador) y, con --demo, escenarios de demostración.
 * Local por defecto; remoto solo con SEED_REMOTE_CONFIRM exacto (nunca en producción).
 */
const env = getEnv();
const logger = createLogger(env, "seed");
const withDemo = process.argv.includes("--demo");

try {
  const guard = assertSeedTarget(env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL, env.NODE_ENV, process.env.SEED_REMOTE_CONFIRM ?? "");
  // Documentos de demo: almacenamiento local, o Supabase Storage solo junto a un destino remoto autorizado.
  if (withDemo && env.STORAGE_DRIVER !== "local" && !guard.remote) throw new Error("El seed de demo local solo usa almacenamiento local");
  const parsed = identitySeedInput.safeParse(process.env);
  if (!parsed.success) {
    // Solo nombres de variables, nunca sus valores.
    throw new Error(`Variables de seed inválidas: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  await withProvisioningDb("seed", { ...env, REMOTE_DB_CONFIRM: guard.remoteConfirm }, logger, async (h) => {
    const identity = await seedIdentity(h.db, parsed.data);
    logger.info({ ...identity, remote: guard.remote }, "Seed de identidad completado");
    if (withDemo) {
      const demo = await seedDemo({
        db: h.db,
        storage: createDocumentStorage(env),
        logger,
        companyId: identity.companyId,
        userId: identity.userId,
        fingerprintSecret: env.ACCOUNT_FINGERPRINT_SECRET,
        period: periodOf(new Date(), parsed.data.SEED_COMPANY_TIMEZONE),
      });
      logger.info({ created: demo.created, scenarios: demo.scenarios.map((s) => `${s.code}: ${s.title} → ${s.expected}`) }, demo.created ? "Escenarios de demo creados" : "Demo ya existente (sin cambios)");
    }
  });
} catch (err) {
  logger.fatal({ err }, "Seed fallido");
  process.exitCode = 1;
}
