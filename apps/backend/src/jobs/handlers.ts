import type { CoreServices } from "../composition.js";
import type { Database } from "../shared/db/client.js";
import type { TaskHandlers } from "./catalog.js";
import { analysisRunHandler } from "./tasks/analysis-run.js";
import { recoverStaleRuns, type RecoveryConfig } from "./tasks/recover-stale-runs.js";
import { systemPing } from "./tasks/system-ping.js";
import type { Logger } from "../shared/logger.js";

/** Handlers del worker con sus dependencias. */
export function createTaskHandlers(deps: { db: Database; core: CoreServices; logger: Logger; recovery: RecoveryConfig }): TaskHandlers {
  return {
    system_ping: systemPing,
    recover_stale_runs: async () => {
      await recoverStaleRuns({ db: deps.db, evaluations: deps.core.evaluations, logger: deps.logger, config: deps.recovery });
    },
    analysis_run: analysisRunHandler({ db: deps.db, evaluations: deps.core.evaluations, makePipeline: (attempt) => deps.core.makePipeline(attempt) }),
  };
}
