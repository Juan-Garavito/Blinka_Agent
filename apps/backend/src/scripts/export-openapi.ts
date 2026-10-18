import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openApiDocument } from "../openapi.js";

/** Exporta el contrato provisional a docs/api/openapi.json (raíz del monorepo). */
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../docs/api/openapi.json");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(openApiDocument, null, 2)}\n`);
process.stdout.write(`OpenAPI exportado: ${out}\n`);
