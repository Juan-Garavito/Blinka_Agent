// Regresión local aislada. No usa credenciales remotas ni elimina bases existentes.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';

process.loadEnvFile('apps/backend/.env');
const original = new URL(process.env.DATABASE_URL);
assert(['localhost', '127.0.0.1', '[::1]', 'postgres'].includes(original.hostname), 'Solo PostgreSQL local');
const database = `blinka_mock_${randomBytes(4).toString('hex')}_test`;
const adminUrl = new URL(original);
adminUrl.pathname = '/postgres';
const admin = new pg.Pool({ connectionString: adminUrl.href });
try { await admin.query(`CREATE DATABASE "${database}"`); } finally { await admin.end(); }
const databaseUrl = new URL(original);
databaseUrl.pathname = `/${database}`;
const storage = mkdtempSync(path.join(tmpdir(), 'blinka-mock-storage-'));
const env = { ...process.env, DATABASE_URL: databaseUrl.href, MIGRATION_DATABASE_URL: databaseUrl.href, DATABASE_SSL: 'disable', REMOTE_DB_CONFIRM: '', NODE_ENV: 'development', AI_PROVIDER: 'fake', AI_ALLOW_FAKE: 'true', GEMINI_API_KEY: 'offline-fictitious-key', FX_PROVIDER: 'fixture', FX_ALLOW_SIMULATED: 'true', STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: storage, PORT: '4002', ALLOWED_ORIGINS: 'http://localhost:4002', SESSION_COOKIE_SECURE: 'false', LOG_LEVEL: 'warn', LOG_FORMAT: 'json', CI: 'true', E2E_BASE_URL: 'http://localhost:4002', PW_CHROME: process.env.PW_CHROME ?? '/usr/bin/google-chrome-stable' };
function launch(args, cwd) { return spawn(process.execPath, args, { cwd, env, stdio: 'inherit' }); }
function done(child) { return new Promise((resolve, reject) => { child.once('error', () => reject(new Error('No se pudo iniciar subproceso local'))); child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Verificación local fallida (${code})`))); }); }
const backend = path.resolve('apps/backend');
let api, worker;
try {
  await done(launch(['dist/shared/db/migrate.js'], backend));
  await done(launch(['dist/shared/db/seed.js', '--demo'], backend));
  api = launch(['dist/server.js'], backend);
  worker = launch(['dist/worker.js'], backend);
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try { ready = (await fetch('http://localhost:4002/ready')).ok; } catch { /* arranque local */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert(ready, 'API aislada no disponible');
  await done(launch(['../../node_modules/@playwright/test/cli.js', 'test', '--output=/tmp/blinka-integration-mock-e2e'], path.resolve('apps/web')));
  process.stdout.write(JSON.stringify({ status: 'MOCK_E2E_VERIFIED', database, host: original.hostname, ai: 'FAKE (MOCK)', fx: 'FIXTURE', interfaceScreenshots: false, browserExternalRequests: 'blocked', note: 'Base local aislada conservada; sin cambios en blinka_dev ni credenciales de blinka_test' }) + '\n');
} finally {
  api?.kill('SIGTERM');
  worker?.kill('SIGTERM');
}
