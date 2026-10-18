import type { Env } from "../../config/env.js";
import { FixtureFxProvider, FrankfurterProvider, type FxProvider } from "./fx.providers.js";

export function createFxProvider(env: Pick<Env, "FX_PROVIDER" | "FX_FIXTURE_RATES" | "FRANKFURTER_URL" | "FX_FRANKFURTER_SOURCES">): FxProvider {
  return env.FX_PROVIDER === "frankfurter" ? new FrankfurterProvider(env.FRANKFURTER_URL, env.FX_FRANKFURTER_SOURCES) : new FixtureFxProvider(env.FX_FIXTURE_RATES);
}
