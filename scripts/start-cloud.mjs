#!/usr/bin/env node
/**
 * Arranca la app completa como en producción, en este equipo:
 *   - build compilado (API sirve el frontend; same-origin), API y worker en procesos separados;
 *   - PostgreSQL y Storage de Supabase (TLS verify-full), IA Gemini real (gasto registrado en ai_usage_logs),
 *     tipo de cambio real (Frankfurter v2), cookies Secure (__Host-), logs JSON.
 * Única diferencia con un despliegue: NODE_ENV=development, porque el origen es http://localhost
 * (en producción el código exige orígenes https://).
 *
 * Uso (desde la raíz):
 *   REMOTE_DB_CONFIRM=aws-0-us-east-1.pooler.supabase.com/postgres npm run start:cloud
 *   npm run start:cloud -- --check   # solo valida configuración, sin conectar a nada
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const backend = path.join(root, "apps/backend");
const PORT = 4003;
const ORIGIN = `http://localhost:${PORT}`;
const envFiles = [".env", ".env.supabase", ".env.gemini"];
const checkOnly = process.argv.includes("--check");

const fail = (msg) => {
  process.stderr.write(`\n✖ ${msg}\n\n`);
  process.exit(1);
};

for (const f of envFiles) if (!existsSync(path.join(backend, f))) fail(`Falta apps/backend/${f}`);
if (!checkOnly) {
  if (!existsSync(path.join(backend, "dist/server.js")) || !existsSync(path.join(root, "apps/web/dist/index.html"))) fail("Falta el build: ejecuta npm run build");
  if (!process.env.REMOTE_DB_CONFIRM) {
    fail("Arranque contra Supabase sin autorización explícita. Repite con:\n  REMOTE_DB_CONFIRM=aws-0-us-east-1.pooler.supabase.com/postgres npm run start:cloud");
  }
}

// Las variables del proceso tienen prioridad sobre --env-file: aquí se fijan las de "producción local".
const env = {
  ...process.env,
  NODE_ENV: "development",
  LOG_FORMAT: "json",
  LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
  HOST: "127.0.0.1",
  PORT: String(PORT),
  ALLOWED_ORIGINS: ORIGIN,
  SESSION_COOKIE_SECURE: "true",
  FX_PROVIDER: process.env.FX_PROVIDER ?? "frankfurter",
};
const nodeArgs = envFiles.map((f) => `--env-file=${f}`);

if (checkOnly) {
  // Sin conexiones: el worker valida su configuración y la API la suya.
  const worker = spawnSync(process.execPath, [...nodeArgs, "--import", "tsx", "src/worker.ts", "--check-config"], { cwd: backend, env, encoding: "utf8" });
  const api = spawnSync(
    process.execPath,
    [...nodeArgs, "--import", "tsx", "-e", `const { parseEnv } = await import("./src/config/env.ts"); const { describeDbTarget } = await import("./src/shared/db/target.ts"); const e = parseEnv(process.env); console.log(JSON.stringify({ entrypoint: "api", origin: e.ALLOWED_ORIGINS, cookieSecure: e.SESSION_COOKIE_SECURE, storage: e.STORAGE_DRIVER, fx: e.FX_PROVIDER, db: describeDbTarget(e.DATABASE_URL), ssl: e.DATABASE_SSL }));`],
    { cwd: backend, env, encoding: "utf8" },
  );
  process.stdout.write((worker.stdout || worker.stderr) + (api.stdout || api.stderr));
  process.exit(worker.status || api.status || 0);
}

const children = [];
const start = (name, script) => {
  const child = spawn(process.execPath, [...nodeArgs, script], { cwd: backend, env, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [child.stdout, child.stderr]) {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) if (line) process.stdout.write(`[${name}] ${line}\n`);
    });
  }
  child.on("exit", (code, signal) => {
    process.stdout.write(`[${name}] terminó (${signal ?? code}); deteniendo todo\n`);
    shutdown(code ?? 1);
  });
  children.push(child);
};

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 8000).unref();
  Promise.all(children.map((c) => (c.exitCode !== null ? null : new Promise((r) => c.on("exit", r))))).then(() => process.exit(code));
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

start("api", "dist/server.js");
start("worker", "dist/worker.js");

// Aviso cuando la API responde /ready.
const deadline = Date.now() + 60_000;
(async function waitReady() {
  while (!stopping && Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/ready`);
      if (r.ok) {
        process.stdout.write(`\n✔ Blinka lista en ${ORIGIN}  (Supabase + Gemini real + FX real; gasto: npm run ai:cost:supabase -w @blinka/backend). Ctrl+C para detener.\n\n`);
        return;
      }
    } catch {
      /* aún arrancando */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
})();
