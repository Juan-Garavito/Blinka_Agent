import { z } from "zod";
import { classifySupabaseKey } from "../modules/documents/storage.js";

const postgresUrl = z
  .url({ protocol: /^postgres(ql)?$/, error: "debe ser una URL postgres:// válida" })
  // El modo TLS se controla solo con DATABASE_SSL: un sslmode en la URL podría
  // sobrescribir la configuración de verificación de pg sin que se note.
  .refine((v) => !/[?&](sslmode|sslrootcert|sslcert|sslkey)=/i.test(v), {
    error: "no incluyas sslmode/sslrootcert en la URL; usa DATABASE_SSL y DATABASE_SSL_CA_FILE",
  });

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres"]);
const isLocalUrl = (url: string) => LOCAL_HOSTS.has(new URL(url).hostname.toLowerCase());

const booleanString = z.enum(["true", "false"]).transform((v) => v === "true");

/**
 * Valor de `trust proxy` de Express. Nunca `true` (confiaría en cualquier
 * X-Forwarded-For enviado por el cliente). Admite:
 * - "false" (por defecto): no hay proxy delante.
 * - un número N de saltos de proxy de confianza (Railway: 1).
 * - una lista de IP/CIDR o alias de Express (loopback, linklocal, uniquelocal).
 */
const trustProxy = z
  .string()
  .trim()
  .refine((v) => v.toLowerCase() !== "true", {
    error: "TRUST_PROXY=true confía en cualquier cabecera del cliente; usa un número de saltos o una lista de IP/CIDR",
  })
  .transform((v): false | number | string[] => {
    if (v.toLowerCase() === "false") return false;
    if (/^\d+$/.test(v)) return Number(v);
    return v.split(",").map((s) => s.trim()).filter(Boolean);
  })
  .refine((v) => typeof v !== "number" || (v >= 1 && v <= 5), { error: "número de saltos entre 1 y 5" })
  .refine((v) => !Array.isArray(v) || v.every((s) => /^[0-9a-fA-F:./]+$|^(loopback|linklocal|uniquelocal)$/.test(s)), {
    error: "lista inválida: solo IP, CIDR o loopback/linklocal/uniquelocal",
  });

const origins = z
  .string()
  .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean))
  .pipe(
    z.array(
      z.url({ protocol: /^https?$/ }).refine((o) => new URL(o).origin === o, {
        error: "cada origen debe ser esquema://host[:puerto] sin ruta ni barra final",
      }),
    ),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  JSON_BODY_LIMIT: z
    .string()
    .regex(/^\d+(b|kb|mb)$/i, "formato esperado: 100kb, 1mb…")
    .default("100kb"),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
  TRUST_PROXY: trustProxy.default(false),

  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
  LOG_FORMAT: z.enum(["json", "pretty"]).default("json"),

  /** Conexión de EJECUCIÓN (api y worker): rol sin permisos DDL en entornos remotos. */
  DATABASE_URL: postgresUrl,
  /** Conexión de APROVISIONAMIENTO (migraciones/seed). Si falta, se usa DATABASE_URL. */
  MIGRATION_DATABASE_URL: postgresUrl.optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  /**
   * disable     → sin TLS (solo PostgreSQL local).
   * require     → TLS cifrado SIN verificar la identidad del servidor (vulnerable a MITM).
   * verify-full → TLS + verificación de cadena de certificados y nombre de host.
   */
  DATABASE_SSL: z.enum(["disable", "require", "verify-full"]).default("disable"),
  /** CA en PEM para verify-full (p. ej. el certificado raíz que publica Supabase). */
  DATABASE_SSL_CA_FILE: z.string().trim().min(1).optional(),

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(2),

  REMOTE_DB_CONFIRM: z.string().trim().default(""),

  /** Orígenes del navegador autorizados para peticiones que modifican estado (CSRF). */
  ALLOWED_ORIGINS: origins.default(["http://localhost:4000", "http://localhost:5173"]),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().min(5).max(1440).default(120),
  SESSION_COOKIE_SECURE: booleanString.default(true),
  SESSION_COOKIE_SAMESITE: z.enum(["strict", "lax"]).default("strict"),
  LOGIN_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  /** Intentos de login (correctos o no) por IP y ventana. */
  LOGIN_RATE_LIMIT_PER_IP: z.coerce.number().int().min(1).max(1000).default(20),
  /** Intentos FALLIDOS por cuenta (correo normalizado) y ventana. */
  LOGIN_RATE_LIMIT_PER_ACCOUNT: z.coerce.number().int().min(1).max(100).default(5),

  /** local: disco privado del servidor (desarrollo/demo). supabase: Supabase Storage privado. */
  STORAGE_DRIVER: z.enum(["local", "supabase"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().trim().min(1).default(".storage"),
  SUPABASE_URL: z.url({ protocol: /^https$/ }).optional(),
  /** Clave de servicio: SOLO servidor. Nunca se envía al navegador ni se registra. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  SUPABASE_STORAGE_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,62}$/).default("blinka-documents"),
  DOCUMENT_MAX_BYTES: z.coerce.number().int().min(1024).max(25 * 1024 * 1024).default(10 * 1024 * 1024),
  /** Clave HMAC para huellas de cuentas bancarias (≥ 32 caracteres). Cambiarla invalida las huellas existentes. */
  ACCOUNT_FINGERPRINT_SECRET: z.string().min(32, "mínimo 32 caracteres").optional(),

  /** frankfurter: Frankfurter v2 con fuente explícita por moneda (COP→BANREP, EUR→BCE). fixture: tasas FIJAS simuladas, solo local/demo. */
  FX_PROVIDER: z.enum(["frankfurter", "fixture"]).default("fixture"),
  FX_FIXTURE_RATES: z.string().default("EUR:USD=1.0850,COP:USD=0.00024,USD:EUR=0.9200,USD:COP=4150"),
  FRANKFURTER_URL: z.url({ protocol: /^https$/ }).default("https://api.frankfurter.dev/v2"),
  /** Fuente (banco central) por moneda en Frankfurter v2; sin fuente, el par no se cotiza. */
  FX_FRANKFURTER_SOURCES: z.string().regex(/^([A-Z]{3}:[A-Z0-9]{2,12})(,[A-Z]{3}:[A-Z0-9]{2,12})*$/).default("COP:BANREP,EUR:ECB,GBP:ECB,MXN:ECB,CAD:ECB,BRL:ECB,CHF:ECB,JPY:ECB"),
  FX_MAX_AGE_HOURS: z.coerce.number().int().min(1).max(240).default(96),
  FX_REUSE_MINUTES: z.coerce.number().int().min(0).max(1440).default(60),
  /** Permite tasas simuladas en producción (demo de hackatón). Queda registrado en cada snapshot. */
  FX_ALLOW_SIMULATED: booleanString.default(false),
  SUPPORTED_CURRENCIES: z
    .string()
    .default("USD,EUR,COP,GBP,MXN,CAD,BRL,CHF,JPY")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(z.string().regex(/^[A-Z]{3}$/)).min(1)),

  /** fake: proveedor SIMULADO (MOCK) solo pruebas/demo local. gemini: Google Gemini (requiere GEMINI_API_KEY). */
  AI_PROVIDER: z.enum(["fake", "gemini"]).default("fake"),
  AI_ALLOW_FAKE: booleanString.default(false),
  /** Clave de Gemini: SOLO servidor/worker. Nunca en el frontend, logs ni repositorio. */
  GEMINI_API_KEY: z.string().min(10).optional(),
  GEMINI_MODEL: z.string().regex(/^[a-z0-9.-]{3,60}$/).default("gemini-2.5-flash"),
  AI_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  AI_TIMEOUT_MS: z.coerce.number().int().min(5000).max(300000).default(60000),
  AI_MAX_STEPS: z.coerce.number().int().min(1).max(8).default(4),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(32768).default(4096),
  AI_MAX_TOTAL_TOKENS: z.coerce.number().int().min(1000).max(1_000_000).default(60000),
  /** Tope DURO por proceso (solo IA real): solicitudes y coste estimado USD. Vacío = sin tope de proceso. */
  AI_MAX_REQUESTS_PER_PROCESS: z.coerce.number().int().min(1).max(1000).optional(),
  AI_MAX_COST_USD_PER_PROCESS: z.string().regex(/^\d{1,4}(\.\d{1,8})?$/).optional(),
  /** Tarifas para el coste ESTIMADO (USD por millón de tokens); verificar con la tarifa vigente. */
  AI_PRICE_INPUT_USD_PER_MTOK: z.string().regex(/^\d{1,6}(\.\d{1,6})?$/).default("0.30"),
  AI_PRICE_OUTPUT_USD_PER_MTOK: z.string().regex(/^\d{1,6}(\.\d{1,6})?$/).default("2.50"),
  ANALYSIS_MAX_PENDING_PER_COMPANY: z.coerce.number().int().min(1).max(200).default(10),
  ANALYSIS_RATE_LIMIT_PER_HOUR: z.coerce.number().int().min(1).max(10000).default(60),
  /** Minutos tras los cuales una corrida RUNNING se considera atascada ante un reintento manual. */
  ANALYSIS_STALE_RUN_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
  /** Recuperación automática (worker): minutos sin actividad, reencolados máximos y frecuencia cron. */
  RECOVERY_STALE_MINUTES: z.coerce.number().int().min(2).max(1440).default(15),
  RECOVERY_MAX_ATTEMPTS: z.coerce.number().int().min(0).max(5).default(2),
  RECOVERY_CRON: z.string().regex(/^[\d*/,-]+( [\d*/,-]+){4}$/).default("*/5 * * * *"),
});

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Configuración de entorno inválida:\n  - ${issues.join("\n  - ")}`);
    this.name = "EnvValidationError";
  }
}

/** Reglas que dependen de varias variables a la vez. */
function crossFieldIssues(env: Env): string[] {
  const issues: string[] = [];
  const prod = env.NODE_ENV === "production";
  if (prod && env.LOG_FORMAT === "pretty") issues.push("LOG_FORMAT: 'pretty' no se permite en producción");
  if (prod && !env.SESSION_COOKIE_SECURE) issues.push("SESSION_COOKIE_SECURE: debe ser true en producción");
  if (env.DATABASE_SSL === "disable" || env.DATABASE_SSL === "require") {
    for (const key of ["DATABASE_URL", "MIGRATION_DATABASE_URL"] as const) {
      const url = env[key];
      if (url && !isLocalUrl(url) && prod) {
        issues.push(`DATABASE_SSL: ${key} apunta a un host remoto; en producción se exige 'verify-full'`);
      }
    }
  }
  if (env.DATABASE_SSL_CA_FILE && env.DATABASE_SSL !== "verify-full") {
    issues.push("DATABASE_SSL_CA_FILE: solo tiene efecto con DATABASE_SSL=verify-full");
  }
  if (env.STORAGE_DRIVER === "supabase" && (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)) {
    issues.push("STORAGE_DRIVER: 'supabase' requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY");
  }
  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    const kind = classifySupabaseKey(env.SUPABASE_SERVICE_ROLE_KEY);
    // Nunca se incluye el valor: solo el tipo detectado.
    if (kind !== "secret" && kind !== "legacy_service_role") issues.push(`SUPABASE_SERVICE_ROLE_KEY: se requiere una clave secreta (sb_secret_…) o service_role heredada; detectado tipo '${kind}'`);
  }
  if (prod && env.FX_PROVIDER === "fixture" && !env.FX_ALLOW_SIMULATED) {
    issues.push("FX_PROVIDER: 'fixture' (tasas simuladas) en producción requiere FX_ALLOW_SIMULATED=true explícito");
  }
  if (env.AI_PROVIDER === "gemini" && !env.GEMINI_API_KEY) issues.push("AI_PROVIDER: 'gemini' requiere GEMINI_API_KEY");
  if ((env.AI_MAX_REQUESTS_PER_PROCESS === undefined) !== (env.AI_MAX_COST_USD_PER_PROCESS === undefined)) {
    issues.push("AI_MAX_REQUESTS_PER_PROCESS y AI_MAX_COST_USD_PER_PROCESS se configuran juntos");
  }
  if (prod && env.AI_PROVIDER === "fake" && !env.AI_ALLOW_FAKE) {
    issues.push("AI_PROVIDER: 'fake' (MOCK) en producción requiere AI_ALLOW_FAKE=true explícito");
  }
  if (prod && !env.ACCOUNT_FINGERPRINT_SECRET) issues.push("ACCOUNT_FINGERPRINT_SECRET: obligatoria en producción");
  if (prod && env.ALLOWED_ORIGINS.some((o) => o.startsWith("http://"))) {
    issues.push("ALLOWED_ORIGINS: en producción solo se admiten orígenes https://");
  }
  return issues;
}

/**
 * Valida variables de entorno. Los mensajes solo nombran la variable y el
 * problema; nunca incluyen el valor recibido (podría ser un secreto).
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Variables vacías se tratan como ausentes para que apliquen los defaults.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ""),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`),
    );
  }
  const issues = crossFieldIssues(result.data);
  if (issues.length > 0) throw new EnvValidationError(issues);
  return result.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv();
  return cached;
}

/** El preflight solo necesita credenciales de BD; no exige claves de IA/Storage. */
export function parseDbConnectionEnv(source: NodeJS.ProcessEnv = process.env) {
  const result = envSchema.pick({ DATABASE_URL: true, MIGRATION_DATABASE_URL: true, DATABASE_SSL: true, DATABASE_SSL_CA_FILE: true, DATABASE_POOL_MAX: true })
    .safeParse(Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value !== "")));
  if (!result.success) throw new EnvValidationError(result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  return result.data;
}
