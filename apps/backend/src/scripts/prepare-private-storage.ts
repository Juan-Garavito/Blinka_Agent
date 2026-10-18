import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getEnv } from "../config/env.js";
import { assertSafeDbTarget, describeDbTarget } from "../shared/db/target.js";
import { supabaseServerAuthHeaders } from "../modules/documents/storage.js";

const env = getEnv();
try {
  const target = describeDbTarget(env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL);
  const refFile = fileURLToPath(new URL("../../../../supabase/.temp/project-ref", import.meta.url));
  const ref = existsSync(refFile) ? readFileSync(refFile, "utf8").trim() : "";
  const u = new URL(env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL);
  if (target.isLocal || !ref || !(u.hostname === `db.${ref}.supabase.co` || (u.hostname.endsWith(".pooler.supabase.com") && decodeURIComponent(u.username).endsWith(`.${ref}`)))) throw new Error("Destino remoto no vinculado o no coincidente");
  if (env.SUPABASE_URL !== `https://${ref}.supabase.co` || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Configurar SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY del proyecto vinculado");
  const endpoint = `${env.SUPABASE_URL}/storage/v1/bucket`;
  const headers = { ...supabaseServerAuthHeaders(env.SUPABASE_SERVICE_ROLE_KEY), "content-type": "application/json" };
  const current = await fetch(`${endpoint}/${encodeURIComponent(env.SUPABASE_STORAGE_BUCKET)}`, { headers, signal: AbortSignal.timeout(10_000), redirect: "error" });
  if (current.ok) {
    const bucket = await current.json() as { public?: boolean };
    if (bucket.public !== false) throw new Error("Bucket existente no privado; se rechaza sin modificarlo");
    process.stdout.write(JSON.stringify({ status: "PRIVATE_BUCKET_EXISTS", project: ref, bucket: env.SUPABASE_STORAGE_BUCKET, writes: 0 }) + "\n");
  } else if (current.status === 404 || (current.status === 400 && ((await current.clone().json().catch(() => null)) as { statusCode?: string } | null)?.statusCode === "404")) {
    // Supabase Storage responde HTTP 400 con statusCode "404" ("Bucket not found") cuando el bucket no existe.
    const plan = { id: env.SUPABASE_STORAGE_BUCKET, name: env.SUPABASE_STORAGE_BUCKET, public: false, file_size_limit: env.DOCUMENT_MAX_BYTES, allowed_mime_types: ["application/pdf", "image/png", "image/jpeg"] };
    if (!process.argv.includes("--apply")) {
      process.stdout.write(JSON.stringify({ status: "AWAITING_AUTHORIZATION", project: ref, target, plan, writes: 0 }) + "\n");
    } else {
      assertSafeDbTarget(u.href, env.REMOTE_DB_CONFIRM, "private-storage");
      const result = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(plan), signal: AbortSignal.timeout(10_000), redirect: "error" });
      if (!result.ok) throw new Error(`Creación de bucket rechazada (HTTP ${result.status}); no se reintenta`);
      process.stdout.write(JSON.stringify({ status: "PRIVATE_BUCKET_CREATED", project: ref, bucket: plan.id }) + "\n");
    }
  } else throw new Error(`Lectura de bucket rechazada (HTTP ${current.status}); no se reintenta`);
} catch (err) {
  process.stdout.write(JSON.stringify({ status: "BLOCKED", reason: err instanceof Error ? err.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[REDACTED]') : "Operación fallida" }) + "\n");
  process.exitCode = 1;
}
