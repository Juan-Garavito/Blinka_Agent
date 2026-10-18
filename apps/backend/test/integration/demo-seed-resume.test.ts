import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeAIProvider } from "../../src/agents/ai/fake.provider.js";
import { seedDemo } from "../../src/modules/demo/demo.seed.js";
import { periodOf } from "../../src/modules/evaluations/decision-engine.js";
import { LocalDocumentStorage, StorageError } from "../../src/modules/documents/storage.js";
import { FixtureFxProvider } from "../../src/modules/fx/fx.providers.js";
import { contracts, invoices, vendors } from "../../src/shared/db/schema.js";
import type { DbHandle } from "../../src/shared/db/client.js";
import { silentLogger } from "../helpers/env.js";
import { companySession, makeTestApp, openTestDb } from "../helpers/identity.js";

/** Almacenamiento que falla hasta habilitarse (simula un bucket de Supabase aún inexistente). */
class FlakyStorage extends LocalDocumentStorage {
  ready = false;
  override async put(key: string, data: Buffer) {
    if (!this.ready) throw new StorageError("Supabase Storage rechazó la subida (HTTP 400)");
    return super.put(key, data);
  }
}

describe("seed de demo reanudable tras fallo de almacenamiento", () => {
  let db: DbHandle;
  beforeAll(async () => {
    db = await openTestDb();
  });
  afterAll(async () => {
    await db?.close();
  });

  it("reutiliza la configuración creada y completa solo las facturas, sin duplicar proveedores ni contratos", async () => {
    const storage = new FlakyStorage(mkdtempSync(path.join(tmpdir(), "blinka-resume-")));
    const app = makeTestApp(db, { storage, fxProvider: new FixtureFxProvider("EUR:USD=1.0850"), aiProvider: new FakeAIProvider() });
    const c = await companySession(db, app);
    const args = { db: db.db, storage, logger: silentLogger, companyId: c.company.id, userId: c.user.id, fingerprintSecret: process.env.ACCOUNT_FINGERPRINT_SECRET, period: periodOf(new Date(), c.company.timezone) };
    const count = async () => {
      const q = (t: typeof vendors | typeof contracts | typeof invoices) => db.db.select({ n: sql<number>`count(*)::int` }).from(t).where(eq(t.companyId, c.company.id));
      return { vendors: (await q(vendors))[0]!.n, contracts: (await q(contracts))[0]!.n, invoices: (await q(invoices))[0]!.n };
    };

    await expect(seedDemo(args)).rejects.toBeInstanceOf(StorageError);
    expect(await count()).toEqual({ vendors: 9, contracts: 8, invoices: 0 });

    storage.ready = true;
    const resumed = await seedDemo(args);
    expect(resumed.created).toBe(true);
    expect(resumed.scenarios).toHaveLength(15);
    expect(await count()).toEqual({ vendors: 9, contracts: 8, invoices: 15 });
    // La cuenta recalculada coincide con la registrada: la factura A conserva su proveedor correcto.
    const [alfa] = await db.db.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.companyId, c.company.id), eq(vendors.taxReference, "900100001")));
    expect(resumed.scenarios.find((s) => s.code === "A")).toBeTruthy();
    expect(alfa).toBeTruthy();

    // Con facturas existentes no se reanuda ni duplica.
    expect((await seedDemo(args)).created).toBe(false);
    expect(await count()).toEqual({ vendors: 9, contracts: 8, invoices: 15 });
  });
});
