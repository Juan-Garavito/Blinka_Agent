import { describeDbTarget } from "./target.js";

/**
 * Las pruebas solo pueden usar una base local cuyo nombre termine en "_test",
 * para que jamás toquen datos de desarrollo ni bases remotas.
 */
export function assertTestDatabaseUrl(url: string | undefined): string {
  if (!url) throw new Error("TEST_DATABASE_URL no está definida");
  const t = describeDbTarget(url);
  if (!t.isLocal || !t.database.endsWith("_test")) {
    throw new Error(
      `TEST_DATABASE_URL debe apuntar a una base local terminada en "_test" (recibido ${t.host}/${t.database})`,
    );
  }
  return url;
}
