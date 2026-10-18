import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { silentLogger } from "../helpers/env.js";

const root = mkdtempSync(path.join(tmpdir(), "blinka-web-"));
mkdirSync(path.join(root, "assets"));
writeFileSync(path.join(root, "index.html"), '<!doctype html><div id="root"></div>');
writeFileSync(path.join(root, "assets/app-123.js"), 'console.log("demo")');
afterAll(() => rmSync(root, { recursive: true, force: true }));
const app = createApp({ env: { JSON_BODY_LIMIT: "1kb", TRUST_PROXY: false }, logger: silentLogger, checkDatabase: () => Promise.resolve(true), frontendDir: root });
describe("frontend same-origin", () => {
  it("sirve rutas profundas como HTML sin caché persistente", async () => {
    const res = await request(app).get("/invoices/abc/evidence").set("Accept", "text/html");
    expect(res.status).toBe(200);
    expect(res.text).toContain('id="root"');
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers["content-security-policy"]).toContain("script-src 'self'");
  });
  it("cachea los assets con hash", async () => {
    const res = await request(app).get("/assets/app-123.js");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toContain("immutable");
  });
  it.each(["/api/missing", "/assets/missing.js", "/missing.png"])("%s conserva el 404", async (url) => {
    const res = await request(app).get(url).set("Accept", "text/html");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
