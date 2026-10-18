/**
 * Completa apps/backend/.env.supabase con secretos SIN mostrarlos: entrada oculta en la terminal, sin argumentos
 * (no quedan en el historial), sin imprimir valores. Uso: npm run supabase:secrets -w @blinka/backend
 * Solo reemplaza los marcadores PENDIENTE_*; Enter vacío conserva el valor actual.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classifySupabaseKey } from "../modules/documents/storage.js";

const file = fileURLToPath(new URL("../../.env.supabase", import.meta.url));
const caFile = fileURLToPath(new URL("../../.certs/supabase-prod-ca-2021.crt", import.meta.url));
if (!existsSync(file)) throw new Error("Falta apps/backend/.env.supabase (perfil local)");
if (!process.stdin.isTTY) throw new Error("Ejecutar en una terminal interactiva (entrada oculta)");

function hidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    let value = "";
    const onData = (buf: Buffer) => {
      for (const ch of buf.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(value);
        }
        if (ch === "\u0003") process.exit(130);
        if (ch === "\u007f") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

let env = readFileSync(file, "utf8");
const pgPassword = await hidden("Contraseña de la base (rol postgres) [Enter = conservar]: ");
if (pgPassword) env = env.replace(/(MIGRATION_DATABASE_URL=postgresql:\/\/postgres\.[a-z0-9]+:)[^@\n]*@/, `$1${encodeURIComponent(pgPassword)}@`);
const secret = await hidden("Clave secreta Supabase (sb_secret_…) [Enter = conservar]: ");
if (secret) {
  const kind = classifySupabaseKey(secret.trim());
  if (kind !== "secret" && kind !== "legacy_service_role") throw new Error(`Clave rechazada: tipo '${kind}' (se requiere sb_secret_…)`);
  env = env.replace(/^SUPABASE_SERVICE_ROLE_KEY=.*$/m, () => `SUPABASE_SERVICE_ROLE_KEY=${secret.trim()}`);
}
writeFileSync(file, env);
chmodSync(file, 0o600);
const pending = [...env.matchAll(/^([A-Z_]+)=.*PENDIENTE_[A-Z_]+/gm)].map((m) => m[1]);
const ca = existsSync(caFile) && readFileSync(caFile, "utf8").includes("BEGIN CERTIFICATE");
process.stdout.write(JSON.stringify({ updated: { postgresPassword: Boolean(pgPassword), secretKey: Boolean(secret) }, pending, caCertificate: ca ? "present" : "missing (.certs/supabase-prod-ca-2021.crt)" }) + "\n");
