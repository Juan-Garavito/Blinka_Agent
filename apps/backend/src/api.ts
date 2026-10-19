import { Router } from "express";
import type { Env } from "./config/env.js";
import { systemRouter } from "./modules/system/system.routes.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes.js";
import { auditRouter } from "./modules/audit/audit.routes.js";
import { approvalsRouter } from "./modules/approvals/approvals.routes.js";
import { createApprovalsService } from "./modules/approvals/approvals.service.js";
import { budgetsRouter } from "./modules/budgets/budgets.routes.js";
import { createBudgetsService } from "./modules/budgets/budgets.service.js";
import type { WorkerUtils } from "graphile-worker";
import type { AIProvider } from "./agents/ai/types.js";
import { createCoreServices } from "./composition.js";
import { analysisRouter } from "./modules/evaluations/analysis.routes.js";
import type { ApprovalHooks } from "./modules/evaluations/evaluation.service.js";
import { evaluationsRouter } from "./modules/evaluations/evaluations.routes.js";
import type { FxProvider } from "./modules/fx/fx.providers.js";
import { policiesRouter } from "./modules/policies/policies.routes.js";
import { createPoliciesService } from "./modules/policies/policies.service.js";
import { companyConfigRouter } from "./modules/company-config/company-config.routes.js";
import { createCompanyConfigService } from "./modules/company-config/company-config.service.js";
import { contractsRouter } from "./modules/contracts/contracts.routes.js";
import { createContractsService } from "./modules/contracts/contracts.service.js";
import { documentsRouter } from "./modules/documents/documents.routes.js";
import { createDocumentsService } from "./modules/documents/documents.service.js";
import type { DocumentStorage } from "./modules/documents/storage.js";
import { loadSession, requireAuth } from "./modules/identity/auth.middleware.js";
import { requireCompanyContext } from "./modules/identity/company-context.js";
import { invoicesRouter } from "./modules/invoices/invoices.routes.js";
import { vendorsRouter } from "./modules/vendors/vendors.routes.js";
import { createVendorsService } from "./modules/vendors/vendors.service.js";
import { createAuthService } from "./modules/identity/auth.service.js";
import { csrfProtection } from "./modules/identity/csrf.middleware.js";
import { createIdentityRepository } from "./modules/identity/identity.repository.js";
import { identityRouter } from "./modules/identity/identity.routes.js";
import { createLoginRateLimiters } from "./modules/identity/login-rate-limit.js";
import type { SessionCookieConfig } from "./modules/identity/session-cookie.js";
import type { DbHandle } from "./shared/db/client.js";
import type { Logger } from "./shared/logger.js";

export type ApiEnv = Pick<
  Env,
  | "ALLOWED_ORIGINS"
  | "SESSION_TTL_HOURS"
  | "SESSION_IDLE_TIMEOUT_MINUTES"
  | "SESSION_COOKIE_SECURE"
  | "SESSION_COOKIE_SAMESITE"
  | "LOGIN_RATE_LIMIT_WINDOW_MINUTES"
  | "LOGIN_RATE_LIMIT_PER_IP"
  | "LOGIN_RATE_LIMIT_PER_ACCOUNT"
  | "DOCUMENT_MAX_BYTES"
  | "ACCOUNT_FINGERPRINT_SECRET"
  | "FX_MAX_AGE_HOURS"
  | "FX_REUSE_MINUTES"
  | "SUPPORTED_CURRENCIES"
  | "AI_MAX_CONCURRENCY"
  | "AI_TIMEOUT_MS"
  | "AI_MAX_STEPS"
  | "AI_MAX_OUTPUT_TOKENS"
  | "AI_MAX_TOTAL_TOKENS"
  | "AI_PRICE_INPUT_USD_PER_MTOK"
  | "AI_PRICE_OUTPUT_USD_PER_MTOK"
  | "ANALYSIS_MAX_PENDING_PER_COMPANY"
  | "ANALYSIS_RATE_LIMIT_PER_HOUR"
  | "ANALYSIS_STALE_RUN_MINUTES"
>;

export interface ApiDeps {
  env: ApiEnv;
  db: DbHandle;
  logger: Logger;
  storage: DocumentStorage;
  fxProvider: FxProvider;
  /** La API no ejecuta IA; se inyecta para compartir la composición con el worker. */
  aiProvider: AIProvider;
  queue: Pick<WorkerUtils, "addJob">;
  approvals?: ApprovalHooks;
  now?: () => Date;
}

/**
 * Composición de los módulos de negocio bajo /api. Orden de middlewares:
 * sesión (si hay cookie) → CSRF/origen para métodos que modifican estado → rutas.
 */
export function createApiRouter({ env, db, logger, storage, fxProvider, aiProvider, queue, approvals, now }: ApiDeps): Router {
  const cookies: SessionCookieConfig = { secure: env.SESSION_COOKIE_SECURE, sameSite: env.SESSION_COOKIE_SAMESITE };
  const identityRepo = createIdentityRepository(db.db);
  const auth = createAuthService({
    repo: identityRepo,
    logger,
    config: {
      sessionTtlMs: env.SESSION_TTL_HOURS * 3_600_000,
      idleTimeoutMs: env.SESSION_IDLE_TIMEOUT_MINUTES * 60_000,
      touchIntervalMs: 60_000,
    },
    ...(now ? { now } : {}),
  });

  const router = Router();
  router.use(loadSession(auth, cookies));
  router.use(csrfProtection(env.ALLOWED_ORIGINS));
  router.use(
    identityRouter({
      auth,
      repo: identityRepo,
      cookies,
      loginRateLimiters: createLoginRateLimiters(
        {
          windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MINUTES * 60_000,
          perIp: env.LOGIN_RATE_LIMIT_PER_IP,
          perAccount: env.LOGIN_RATE_LIMIT_PER_ACCOUNT,
        },
        db.pool,
      ),
    }),
  );

  // Todo lo que sigue exige sesión y una empresa autorizada por membresía.
  const scoped = Router();
  scoped.use(requireAuth, requireCompanyContext(identityRepo));
  scoped.use(companyConfigRouter(createCompanyConfigService(db.db)));
  scoped.use(vendorsRouter(createVendorsService({ db: db.db, fingerprintSecret: env.ACCOUNT_FINGERPRINT_SECRET })));
  scoped.use(documentsRouter(createDocumentsService({ db: db.db, storage, logger, maxBytes: env.DOCUMENT_MAX_BYTES }), env.DOCUMENT_MAX_BYTES));
  scoped.use(contractsRouter(createContractsService(db.db)));
  const core = createCoreServices({ env, db, logger, storage, fxProvider, aiProvider, ...(approvals ? { approvals } : {}), ...(now ? { now } : {}) });
  scoped.use(invoicesRouter(core.invoices));
  scoped.use(policiesRouter(createPoliciesService(db.db)));
  scoped.use(budgetsRouter(createBudgetsService(db.db)));
  scoped.use(evaluationsRouter(core.evaluations));
  scoped.use(
    auditRouter(db.db, { provider: aiProvider.name, model: aiProvider.model, simulated: aiProvider.isSimulated, inputUsdPerMTok: env.AI_PRICE_INPUT_USD_PER_MTOK, outputUsdPerMTok: env.AI_PRICE_OUTPUT_USD_PER_MTOK }),
  );
  scoped.use(systemRouter({ aiProvider, fxProvider, storage }));
  scoped.use(dashboardRouter(db.db));
  scoped.use(approvalsRouter(createApprovalsService({ db: db.db, evaluations: core.evaluations })));
  scoped.use(
    analysisRouter({
      db: db.db,
      pool: db.pool,
      evaluations: core.evaluations,
      queue,
      limits: { maxPendingPerCompany: env.ANALYSIS_MAX_PENDING_PER_COMPANY, perHour: env.ANALYSIS_RATE_LIMIT_PER_HOUR, staleRunMinutes: env.ANALYSIS_STALE_RUN_MINUTES },
    }),
  );
  router.use(scoped);
  return router;
}
