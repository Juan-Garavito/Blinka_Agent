/** Error nativo de PostgreSQL (pg.DatabaseError) con los campos que usamos. */
export interface PgErrorInfo {
  code: string;
  constraint?: string;
  table?: string;
}

/**
 * Extrae el error de PostgreSQL, desenvolviendo DrizzleQueryError (cuyo
 * mensaje incluye los parámetros de la consulta y nunca debe exponerse ni loguearse).
 */
export function pgErrorOf(err: unknown): PgErrorInfo | undefined {
  let cur: unknown = err;
  for (let i = 0; i < 3 && cur; i++) {
    if (typeof cur === "object" && cur !== null && "code" in cur && typeof cur.code === "string" && /^[0-9A-Z]{5}$/.test(cur.code)) {
      const e = cur as { code: string; constraint?: unknown; table?: unknown };
      return {
        code: e.code,
        ...(typeof e.constraint === "string" ? { constraint: e.constraint } : {}),
        ...(typeof e.table === "string" ? { table: e.table } : {}),
      };
    }
    cur = typeof cur === "object" && cur !== null && "cause" in cur ? cur.cause : undefined;
  }
  return undefined;
}
