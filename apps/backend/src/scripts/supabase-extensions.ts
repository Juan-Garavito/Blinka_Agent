/**
 * Instala btree_gist en el esquema `extensions` (práctica recomendada por Supabase) ANTES de migrar; la
 * migración 0005 (`CREATE EXTENSION IF NOT EXISTS btree_gist`) la encontrará y no la creará en public.
 * Requiere REMOTE_DB_CONFIRM exacto para destinos remotos. Uso: npm run db:extensions:supabase -w @blinka/backend
 */
import pg from "pg";
import { buildSslOptions } from "../shared/db/client.js";
import { assertSafeDbTarget } from "../shared/db/target.js";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("Falta MIGRATION_DATABASE_URL");
const target = assertSafeDbTarget(url, process.env.REMOTE_DB_CONFIRM ?? "", "create-extension-btree_gist");
const client = new pg.Client({ connectionString: url, ssl: buildSslOptions({ DATABASE_SSL: (process.env.DATABASE_SSL ?? "disable") as "verify-full", DATABASE_SSL_CA_FILE: process.env.DATABASE_SSL_CA_FILE }) });
await client.connect();
try {
  await client.query("CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions");
  const ext = await client.query<{ version: string; schema: string }>("select e.extversion as version, n.nspname as schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'btree_gist'");
  process.stdout.write(JSON.stringify({ status: "OK", target: `${target.host}/${target.database}`, btree_gist: ext.rows[0] }) + "\n");
} finally {
  await client.end();
}
