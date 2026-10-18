import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseDbConnectionEnv } from "../config/env.js";
import { assertSessionConnection } from "../integration/connection.js";
import { createDb } from "../shared/db/client.js";
import { describeDbTarget } from "../shared/db/target.js";
import { createLogger } from "../shared/logger.js";

const env = parseDbConnectionEnv();
const linkedPath = fileURLToPath(new URL("../../../../supabase/.temp/project-ref", import.meta.url));
const linkedProject = existsSync(linkedPath) ? readFileSync(linkedPath, "utf8").trim() : null;
const runtime = process.argv.includes("--runtime");
const url = runtime ? env.DATABASE_URL : env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL;
const target = describeDbTarget(url);
let handle: ReturnType<typeof createDb> | undefined;
try {
  if (/PENDIENTE_/.test(url)) throw new Error("Credencial pendiente en .env.supabase (ejecutar npm run supabase:secrets -w @blinka/backend)");
  assertSessionConnection(env.DATABASE_URL);
  if (!target.isLocal && env.DATABASE_SSL !== "verify-full") throw new Error("Preflight remoto requiere DATABASE_SSL=verify-full");
  const parsed = new URL(url);
  if (!target.isLocal && !linkedProject) throw new Error("Vincular un proyecto Supabase antes del preflight remoto");
  if (!target.isLocal && linkedProject && !(target.host === `db.${linkedProject}.supabase.co` || (target.host.endsWith(".pooler.supabase.com") && decodeURIComponent(parsed.username).endsWith(`.${linkedProject}`)))) throw new Error("Destino de conexión no coincide con el proyecto vinculado");
  handle = createDb({ ...env, DATABASE_URL: url, DATABASE_POOL_MAX: 1 }, createLogger({ LOG_LEVEL: "silent", LOG_FORMAT: "json" }, "preflight"), "blinka-readonly-preflight");
  const client = await handle.pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout='5000ms'");
    const identity = await client.query(`select current_database() as database, current_user as database_user,
      current_setting('server_version') as postgres_version, current_setting('server_version_num')::int as postgres_version_num,
      current_setting('transaction_read_only') as read_only,
      (select ssl from pg_stat_ssl where pid=pg_backend_pid()) as ssl,
      has_database_privilege(current_user,current_database(),'CONNECT') as can_connect,
      has_database_privilege(current_user,current_database(),'CREATE') as can_create_schema,
      has_schema_privilege(current_user,'public','CREATE') as can_create_public,
      (select rolsuper from pg_roles where rolname=current_user) as superuser,
      (select rolcreaterole from pg_roles where rolname=current_user) as can_create_roles`);
    const extensions = await client.query("select name, installed_version, default_version from pg_available_extensions where name in ('btree_gist','pgcrypto') order by name");
    const schemas = await client.query("select nspname, has_schema_privilege(current_user,oid,'USAGE') as can_use, has_schema_privilege(current_user,oid,'CREATE') as can_create from pg_namespace where nspname in ('public','drizzle','graphile_worker','storage') order by nspname");
    const migrationTable = await client.query<{ present: boolean }>("select to_regclass('graphile_worker.migrations') is not null as present");
    let graphile: unknown = { present: false, runtimeStartupMayExecuteDDL: true };
    if (migrationTable.rows[0]?.present) {
      const revision = await client.query<{ revision: number }>("select max(id) as revision from graphile_worker.migrations");
      graphile = { present: true, revision: revision.rows[0]?.revision, expectedRevisionFor018: 20, runtimeStartupMayExecuteDDL: true };
    }
    await client.query("ROLLBACK");
    process.stdout.write(JSON.stringify({ status: "READ_ONLY_VERIFIED", linkedProject, target, connection: !runtime && env.MIGRATION_DATABASE_URL ? "MIGRATION_DATABASE_URL" : "DATABASE_URL", runtimeTarget: describeDbTarget(env.DATABASE_URL), identity: identity.rows[0] as unknown, extensions: extensions.rows as unknown[], schemas: schemas.rows as unknown[], graphile, note: "No prueba arranque de Graphile: puede ejecutar DDL. No arrancar API/worker remotos sin autorización." }, null, 2) + "\n");
  } finally { client.release(); }
} catch (err) {
  process.stdout.write(JSON.stringify({ status: "BLOCKED", target, linkedProject, reason: err instanceof Error && !('code' in err) ? err.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[REDACTED]') : "Conexión o permisos rechazados; detalles sensibles omitidos" }) + "\n");
  process.exitCode = 1;
} finally { await handle?.close(); }
