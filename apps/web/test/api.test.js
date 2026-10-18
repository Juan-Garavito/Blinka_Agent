import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, onUnauthorized, setCsrfToken } from "../src/lib/api.js";

const json = (status, body, headers = {}) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("cliente API same-origin", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setCsrfToken(null);
  });

  it("envía cookies same-origin y el token CSRF SOLO en métodos que modifican estado", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(async () => json(200, { ok: true }));
    setCsrfToken("tok-123");
    await api("/api/vendors");
    await api("/api/vendors", { method: "POST", body: { legalName: "X" } });
    const [, getInit] = f.mock.calls[0];
    const [, postInit] = f.mock.calls[1];
    expect(getInit.credentials).toBe("same-origin");
    expect(getInit.headers["X-CSRF-Token"]).toBeUndefined();
    expect(postInit.headers["X-CSRF-Token"]).toBe("tok-123");
    expect(postInit.headers["Content-Type"]).toBe("application/json");
    expect(postInit.body).toBe('{"legalName":"X"}');
  });

  it("normaliza errores del backend (código, mensaje, requestId) y 204", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json(409, { error: { code: "ALREADY_AUTHORIZED", message: "Ya autorizada", requestId: "abc" } })).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const err = await api("/api/x", { method: "POST", body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "ALREADY_AUTHORIZED", message: "Ya autorizada", requestId: "abc" });
    expect(await api("/api/y", { method: "POST" })).toBeNull();
  });

  it("401 notifica a la sesión (salvo cuando se pide omitirlo)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => json(401, { error: { code: "SESSION_EXPIRED", message: "expiró" } }));
    const seen = [];
    const off = onUnauthorized((e) => seen.push(e.code));
    await api("/api/a").catch(() => {});
    await api("/api/b", { skipUnauthorizedHandler: true }).catch(() => {});
    off();
    expect(seen).toEqual(["SESSION_EXPIRED"]);
  });

  it("caída de red → ApiError NETWORK con mensaje accionable; 429 con mensaje genérico", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(new Response("x", { status: 429 }));
    const net = await api("/api/x").catch((e) => e);
    expect(net).toMatchObject({ status: 0, code: "NETWORK" });
    expect(net.isNetwork).toBe(true);
    const rl = await api("/api/x").catch((e) => e);
    expect(rl).toMatchObject({ status: 429, code: "HTTP_429" });
    expect(rl.message).toMatch(/Demasiadas solicitudes/);
  });
});
