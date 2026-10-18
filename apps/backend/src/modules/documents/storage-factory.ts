import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Env } from "../../config/env.js";
import { LocalDocumentStorage, SupabaseDocumentStorage, type DocumentStorage } from "./storage.js";

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export function createDocumentStorage(
  env: Pick<Env, "STORAGE_DRIVER" | "STORAGE_LOCAL_DIR" | "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY" | "SUPABASE_STORAGE_BUCKET">,
): DocumentStorage {
  if (env.STORAGE_DRIVER === "supabase") {
    return new SupabaseDocumentStorage({ url: env.SUPABASE_URL!, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY!, bucket: env.SUPABASE_STORAGE_BUCKET });
  }
  return new LocalDocumentStorage(path.resolve(BACKEND_ROOT, env.STORAGE_LOCAL_DIR));
}
