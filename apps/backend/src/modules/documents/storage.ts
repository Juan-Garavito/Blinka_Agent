import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Almacenamiento privado de documentos. Las claves las genera el backend con
 * el formato companies/<uuid>/documents/<uuid>; nunca contienen datos del cliente.
 */
export interface DocumentStorage {
  readonly driver: "local" | "supabase";
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** URL temporal de descarga directa, si el proveedor la admite. */
  createSignedUrl?(key: string, expiresInSeconds: number): Promise<string>;
}

export class StorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StorageError";
  }
}

const KEY_PATTERN = /^companies\/[0-9a-f-]{36}\/documents\/[0-9a-f-]{36}$/;

function assertKey(key: string): void {
  if (!KEY_PATTERN.test(key)) throw new StorageError("Clave de almacenamiento inválida");
}

/**
 * Disco local del servidor (desarrollo y demo local). Directorio 0700 y
 * archivos 0600; nunca se sobrescribe un archivo existente.
 */
export class LocalDocumentStorage implements DocumentStorage {
  readonly driver = "local" as const;
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = path.resolve(baseDir);
  }

  private pathFor(key: string): string {
    assertKey(key);
    const full = path.resolve(this.baseDir, key);
    // Defensa adicional contra path traversal aunque la clave ya esté validada.
    if (!full.startsWith(this.baseDir + path.sep)) throw new StorageError("Ruta fuera del almacenamiento");
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.pathFor(key);
    await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    await writeFile(full, data, { flag: "wx", mode: 0o600 });
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.pathFor(key));
    } catch (err) {
      throw new StorageError("Documento no disponible en el almacenamiento", { cause: err });
    }
  }
}

/**
 * Supabase Storage (bucket PRIVADO) vía su API REST con `fetch` nativo.
 * La clave de servicio solo vive en el servidor.
 * ESTADO: implementado y probado con `fetch` simulado; NO verificado contra
 * un proyecto Supabase real (requiere credenciales y autorización). Acepta `sb_secret_…` (recomendada) y
 * la clave heredada service_role; rechaza publishable/anon en la configuración.
 */
export type SupabaseKeyKind = "secret" | "legacy_service_role" | "publishable" | "legacy_anon_or_other" | "unknown";

/**
 * Tipo de clave de Supabase SIN verificarla ni registrarla. Las claves nuevas `sb_secret_…` no son JWT;
 * las heredadas `service_role` son JWT (se lee solo el claim `role` del payload, sin confiar en él para nada más).
 */
export function classifySupabaseKey(key: string): SupabaseKeyKind {
  if (key.startsWith("sb_secret_")) return "secret";
  if (key.startsWith("sb_publishable_")) return "publishable";
  const parts = key.split(".");
  if (parts.length === 3 && key.startsWith("eyJ")) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as { role?: string };
      return payload.role === "service_role" ? "legacy_service_role" : "legacy_anon_or_other";
    } catch {
      return "unknown";
    }
  }
  return "unknown";
}

/**
 * Cabeceras de servidor para Supabase. Documentación (API keys): las claves nuevas van en `apikey`, NO en
 * `Authorization: Bearer` (no son JWT; verificarlas como JWT falla). La clave heredada service_role conserva ambas.
 */
export function supabaseServerAuthHeaders(key: string): Record<string, string> {
  return classifySupabaseKey(key) === "legacy_service_role" ? { authorization: `Bearer ${key}`, apikey: key } : { apikey: key };
}

export class SupabaseDocumentStorage implements DocumentStorage {
  readonly driver = "supabase" as const;

  constructor(
    private readonly cfg: { url: string; serviceRoleKey: string; bucket: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { ...supabaseServerAuthHeaders(this.cfg.serviceRoleKey), ...extra };
  }

  private objectUrl(kind: "object" | "object/authenticated" | "object/sign", key: string): string {
    assertKey(key);
    return `${this.cfg.url.replace(/\/$/, "")}/storage/v1/${kind}/${encodeURIComponent(this.cfg.bucket)}/${key}`;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const res = await this.fetchImpl(this.objectUrl("object", key), {
      method: "POST",
      headers: this.headers({ "content-type": contentType, "x-upsert": "false" }),
      body: new Uint8Array(data),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new StorageError(`Supabase Storage rechazó la subida (HTTP ${res.status})`);
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.fetchImpl(this.objectUrl("object/authenticated", key), {
      headers: this.headers(),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new StorageError(`Supabase Storage no devolvió el documento (HTTP ${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  async createSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    const res = await this.fetchImpl(this.objectUrl("object/sign", key), {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({ expiresIn: expiresInSeconds }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new StorageError(`Supabase Storage no firmó la URL (HTTP ${res.status})`);
    const body = (await res.json()) as { signedURL?: unknown };
    if (typeof body.signedURL !== "string" || !body.signedURL.startsWith("/")) throw new StorageError("Respuesta de firma inválida");
    return `${this.cfg.url.replace(/\/$/, "")}/storage/v1${body.signedURL}`;
  }
}
