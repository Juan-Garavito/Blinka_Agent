import { describeDbTarget } from "../shared/db/target.js";

/** Graphile usa LISTEN y estado de sesión; Supavisor transaction :6543 no sirve. */
export function assertSessionConnection(url: string): void {
  const target = describeDbTarget(url);
  const parsed = new URL(url);
  if (!target.isLocal && (target.port === "6543" || /transaction/i.test(parsed.searchParams.get("pool_mode") ?? "") || parsed.searchParams.get("pgbouncer") === "true")) {
    throw new Error("Graphile Worker requiere conexión directa o Session pooler; no transaction pooling");
  }
}
