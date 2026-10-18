import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

// Solo nombres/categorías: jamás fragmentos ni valores de credenciales.
const files = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0').filter(Boolean))];
const findings = [];
const documents = [];
const detectors = [
  ['google-api-key', /AIza[0-9A-Za-z_-]{30,}/],
  ['supabase-access-token', /sbp_[0-9a-zA-Z]{25,}/],
  ['supabase-secret-key', /sb_secret_[0-9a-zA-Z_-]{20,}/],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
  ['github-token', /(?:ghp_|github_pat_)[A-Za-z0-9_]{30,}/],
  ['jwt', /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/],
];
for (const file of files) {
  if (/(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.example')) findings.push({ file, category: 'env-publicable' });
  if (/(?:\.key|\.p12|\.pfx|\.pem)$|(?:^|\/)(?:access-token|\.npmrc|\.pgpass|\.netrc)$|supabase\/\.temp\//.test(file)) findings.push({ file, category: 'private-file-publicable' });
  let buffer;
  try { if (!statSync(file).isFile()) continue; buffer = readFileSync(file); } catch { continue; }
  if (/\.(pdf|png|jpe?g)$/i.test(file)) {
    const fixture = file.startsWith('docs/implementation/evidence/') || (/\b(?:FICTICI[OA]|PRUEBA)\b/.test(buffer.toString('latin1')) && file.startsWith('docs/demo/'));
    documents.push({ file, classification: fixture ? 'local-demo-evidence-or-fictional-fixture' : 'REVIEW_REQUIRED' });
    if (!fixture) findings.push({ file, category: 'document-review-required' });
    continue;
  }
  if (buffer.includes(0) || buffer.length > 4_000_000) continue;
  const text = buffer.toString('utf8');
  for (const match of text.matchAll(/postgres(?:ql)?:\/\/[^\s"'`<>]+/g)) {
    try {
      const url = new URL(match[0]);
      if (url.password && !['localhost', '127.0.0.1', '[::1]', 'postgres'].includes(url.hostname)) {
        // Fixtures/plantillas explícitas; cualquier credencial real sigue siendo hallazgo.
        const password = decodeURIComponent(url.password);
        if (!/^(p|pass|pw|password|secret|clave-ficticia|test|YOUR-PASSWORD|\[.*\]|.*fictici.*)$/i.test(password)) findings.push({ file, category: 'remote-database-credential-review' });
      }
    } catch { /* plantilla no parseable, no se imprime */ }
  }
  for (const [category, pattern] of detectors) if (pattern.test(text)) findings.push({ file, category });
}
for (const file of ['apps/backend/.env','apps/backend/.env.gemini','apps/backend/.env.supabase','supabase/.temp/project-ref','supabase/.temp/pooler-url']) {
  try { execFileSync('git', ['check-ignore', '--quiet', file]); }
  catch { findings.push({ file, category: 'missing-ignore-rule' }); }
}
process.stdout.write(JSON.stringify({ status: findings.length ? 'REVIEW_REQUIRED' : 'PASS', scannedFiles: files.length, findings, documents, limits: 'Auditoría heurística de archivos publicables; no certifica ausencia de todos los secretos ni sustituye revisión humana de documentos.' }, null, 2) + '\n');
process.exitCode = findings.length ? 1 : 0;
