import type { Env } from "./config/env.js";
import { FakeAIProvider } from "./agents/ai/fake.provider.js";
import { GeminiProvider } from "./agents/ai/gemini.provider.js";
import { BudgetedAIProvider } from "./agents/ai/budget.js";
import type { AIProvider } from "./agents/ai/types.js";
import { Semaphore } from "./agents/harness.js";
import { createAnalysisPipeline } from "./agents/pipeline.js";
import { approvalHooks } from "./modules/approvals/approvals.hooks.js";
import type { DocumentStorage } from "./modules/documents/storage.js";
import { createEvaluationService, type ApprovalHooks } from "./modules/evaluations/evaluation.service.js";
import type { FxProvider } from "./modules/fx/fx.providers.js";
import { createFxService } from "./modules/fx/fx.service.js";
import { createInvoicesService } from "./modules/invoices/invoices.service.js";
import type { DbHandle } from "./shared/db/client.js";
import type { Logger } from "./shared/logger.js";

export type CoreEnv = Pick<
  Env,
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
>;

export function createAIProvider(
  env: Pick<Env, "AI_PROVIDER" | "GEMINI_API_KEY" | "GEMINI_MODEL" | "AI_PRICE_INPUT_USD_PER_MTOK" | "AI_PRICE_OUTPUT_USD_PER_MTOK"> & Partial<Pick<Env, "AI_MAX_REQUESTS_PER_PROCESS" | "AI_MAX_COST_USD_PER_PROCESS">>,
): AIProvider {
  if (env.AI_PROVIDER !== "gemini") return new FakeAIProvider();
  const gemini = new GeminiProvider({ apiKey: env.GEMINI_API_KEY!, model: env.GEMINI_MODEL });
  if (env.AI_MAX_REQUESTS_PER_PROCESS === undefined || env.AI_MAX_COST_USD_PER_PROCESS === undefined) return gemini;
  return new BudgetedAIProvider(gemini, { maxRequests: env.AI_MAX_REQUESTS_PER_PROCESS, maxCostUsd: env.AI_MAX_COST_USD_PER_PROCESS }, { inputUsdPerMTok: env.AI_PRICE_INPUT_USD_PER_MTOK, outputUsdPerMTok: env.AI_PRICE_OUTPUT_USD_PER_MTOK });
}

/**
 * Servicios de dominio compartidos por los procesos api y worker (mismo
 * código, misma BD): evaluación determinista, FX y pipeline de análisis.
 */
export function createCoreServices(deps: {
  env: CoreEnv;
  db: DbHandle;
  logger: Logger;
  storage: DocumentStorage;
  fxProvider: FxProvider;
  aiProvider: AIProvider;
  approvals?: ApprovalHooks;
  now?: () => Date;
}) {
  const { env, db, logger } = deps;
  const fx = createFxService({ db: db.db, provider: deps.fxProvider, logger, config: { maxAgeHours: env.FX_MAX_AGE_HOURS, reuseMinutes: env.FX_REUSE_MINUTES }, ...(deps.now ? { now: deps.now } : {}) });
  const supportedCurrencies = new Set(env.SUPPORTED_CURRENCIES);
  const evaluations = createEvaluationService({
    db: db.db,
    fx,
    logger,
    fingerprintSecret: env.ACCOUNT_FINGERPRINT_SECRET,
    supportedCurrencies,
    approvals: deps.approvals ?? approvalHooks,
    ...(deps.now ? { now: deps.now } : {}),
  });
  const invoices = createInvoicesService(db.db, { fingerprintSecret: env.ACCOUNT_FINGERPRINT_SECRET });
  const semaphore = new Semaphore(env.AI_MAX_CONCURRENCY);
  const makePipeline = (attempt?: { current: number; max: number }) =>
    createAnalysisPipeline({
      db: db.db,
      storage: deps.storage,
      provider: deps.aiProvider,
      semaphore,
      invoices,
      evaluations,
      logger,
      limits: { maxSteps: env.AI_MAX_STEPS, maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS, maxTotalTokens: env.AI_MAX_TOTAL_TOKENS, timeoutMs: env.AI_TIMEOUT_MS },
      pricing: { inputUsdPerMTok: env.AI_PRICE_INPUT_USD_PER_MTOK, outputUsdPerMTok: env.AI_PRICE_OUTPUT_USD_PER_MTOK },
      fingerprintSecret: env.ACCOUNT_FINGERPRINT_SECRET,
      supportedCurrencies,
      ...(attempt ? { attempt } : {}),
      ...(deps.now ? { now: deps.now } : {}),
    });
  return { fx, evaluations, invoices, makePipeline };
}

export type CoreServices = ReturnType<typeof createCoreServices>;
