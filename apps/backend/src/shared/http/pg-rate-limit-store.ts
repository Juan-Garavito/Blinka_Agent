import type { ClientRateLimitInfo, Options, Store } from "express-rate-limit";
import type pg from "pg";

/**
 * Almacén de express-rate-limit en PostgreSQL (ventana fija). Cada incremento
 * es un único UPSERT atómico, por lo que varias instancias de la API comparten
 * el mismo contador. Los reloj usados son los de la BD (now()).
 */
export class PgRateLimitStore implements Store {
  windowMs = 60_000;
  readonly prefix: string;

  constructor(
    private readonly pool: pg.Pool,
    prefix: string,
  ) {
    this.prefix = `${prefix}:`;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private k(key: string) {
    return `${this.prefix}${key}`;
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const { rows } = await this.pool.query<{ hits: number; reset_at: Date }>(
      "select hits, reset_at from rate_limit_buckets where key = $1 and reset_at > now()",
      [this.k(key)],
    );
    const row = rows[0];
    return row ? { totalHits: row.hits, resetTime: row.reset_at } : undefined;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const { rows } = await this.pool.query<{ hits: number; reset_at: Date }>(
      `insert into rate_limit_buckets as b (key, hits, reset_at)
         values ($1, 1, now() + make_interval(secs => $2::double precision / 1000))
       on conflict (key) do update set
         hits = case when b.reset_at <= now() then 1 else b.hits + 1 end,
         reset_at = case when b.reset_at <= now() then excluded.reset_at else b.reset_at end
       returning hits, reset_at`,
      [this.k(key), this.windowMs],
    );
    const row = rows[0]!;
    return { totalHits: row.hits, resetTime: row.reset_at };
  }

  async decrement(key: string): Promise<void> {
    await this.pool.query(
      "update rate_limit_buckets set hits = greatest(hits - 1, 0) where key = $1 and reset_at > now()",
      [this.k(key)],
    );
  }

  async resetKey(key: string): Promise<void> {
    await this.pool.query("delete from rate_limit_buckets where key = $1", [this.k(key)]);
  }
}
