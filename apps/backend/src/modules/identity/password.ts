import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Hash de contraseñas con Argon2id (node:crypto, Node ≥ 24.7), serializado en
 * formato PHC: $argon2id$v=19$m=<KiB>,t=<pasadas>,p=<paralelismo>$<salt>$<hash>
 * Parámetros por defecto: recomendación OWASP (m=19 MiB, t=2, p=1).
 */
export interface Argon2Params {
  memoryKiB: number;
  passes: number;
  parallelism: number;
}

export const DEFAULT_ARGON2_PARAMS: Argon2Params = { memoryKiB: 19456, passes: 2, parallelism: 1 };

const SALT_BYTES = 16;
const TAG_BYTES = 32;
/** Evita usar Argon2 como vector de DoS con entradas enormes. */
export const MAX_PASSWORD_LENGTH = 256;

const PHC_PATTERN = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

const b64 = (buf: Buffer) => buf.toString("base64").replace(/=+$/, "");

function derive(password: string, salt: Buffer, params: Argon2Params, tagLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      "argon2id",
      {
        message: password,
        nonce: salt,
        memory: params.memoryKiB,
        passes: params.passes,
        parallelism: params.parallelism,
        tagLength,
      },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string, params: Argon2Params = DEFAULT_ARGON2_PARAMS): Promise<string> {
  if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
    throw new RangeError("Longitud de contraseña no admitida");
  }
  const salt = randomBytes(SALT_BYTES);
  const tag = await derive(password, salt, params, TAG_BYTES);
  return `$argon2id$v=19$m=${params.memoryKiB},t=${params.passes},p=${params.parallelism}$${b64(salt)}$${b64(tag)}`;
}

interface ParsedHash {
  params: Argon2Params;
  salt: Buffer;
  tag: Buffer;
}

function parseHash(encoded: string): ParsedHash | undefined {
  const m = PHC_PATTERN.exec(encoded);
  if (!m) return undefined;
  const [, mem, t, p, salt, tag] = m;
  const params = { memoryKiB: Number(mem), passes: Number(t), parallelism: Number(p) };
  // Límites defensivos frente a un hash manipulado en la BD.
  if (params.memoryKiB > 262144 || params.passes > 10 || params.parallelism > 8) return undefined;
  return { params, salt: Buffer.from(salt!, "base64"), tag: Buffer.from(tag!, "base64") };
}

/** Verifica en tiempo constante. Un hash ilegible se trata como no coincidente. */
export async function verifyPassword(encoded: string, password: string): Promise<boolean> {
  if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH) return false;
  const parsed = parseHash(encoded);
  if (!parsed || parsed.tag.length < 16) return false;
  const candidate = await derive(password, parsed.salt, parsed.params, parsed.tag.length);
  return timingSafeEqual(candidate, parsed.tag);
}

/** true si el hash usa parámetros distintos de los actuales (rehash tras login correcto). */
export function needsRehash(encoded: string, params: Argon2Params = DEFAULT_ARGON2_PARAMS): boolean {
  const parsed = parseHash(encoded);
  return (
    !parsed ||
    parsed.params.memoryKiB !== params.memoryKiB ||
    parsed.params.passes !== params.passes ||
    parsed.params.parallelism !== params.parallelism
  );
}

/**
 * Hash señuelo para igualar el tiempo de respuesta cuando el usuario no existe
 * o está inactivo, y no revelar qué correos están registrados.
 */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(24).toString("base64"));
  return dummyHash;
}
