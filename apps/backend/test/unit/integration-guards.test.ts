import { describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { GeminiProvider } from "../../src/agents/ai/gemini.provider.js";
import type { AIRequest } from "../../src/agents/ai/types.js";
import { assertSessionConnection } from "../../src/integration/connection.js";
import { boundedGeminiFetch, listGeminiModels } from "../../src/integration/gemini-probe.js";
import { parseDbConnectionEnv } from "../../src/config/env.js";
import { createJobQueue } from "../../src/jobs/queue.js";
import { silentLogger } from "../helpers/env.js";

const req: AIRequest = { system: "Extrae datos ficticios", messages: [{ role: "user", parts: [{ text: "PDF ficticio" }] }], tools: [], responseJsonSchema: { type: "object" }, maxOutputTokens: 256, signal: AbortSignal.timeout(5000) };

describe("Gemini real: protocolo, límites y facturación (transporte MOCK offline)", () => {
  it("preserva firma y id de función entre llamadas sin registrar pensamientos", async () => {
    const parts = [{ functionCall: { name: "get_vendor_profile", args: {}, id: "provider-call-1" }, thoughtSignature: "firma-opaca-ficticia" }];
    const transport = vi.fn().mockResolvedValueOnce(Response.json({ candidates: [{ content: { role: "model", parts } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 20 } })).mockResolvedValueOnce(Response.json({ candidates: [{ content: { parts: [{ thought: true, text: "No debe convertirse en JSON" }, { text: '{"documentKind":"INVOICE"}' }] } }] }));
    const provider = new GeminiProvider({ apiKey: "ficticia", model: "gemini-3.8-flash" }, transport);
    const first = await provider.generate(req);
    expect(first.usage).toEqual({ inputTokens: 10, outputTokens: 25 });
    expect(first.kind).toBe("tool_calls");
    if (first.kind !== "tool_calls") throw new Error("Tipo inesperado");
    const second = await provider.generate({ ...req, messages: [...req.messages, { role: "model_tool_calls", calls: first.calls, modelContent: first.modelContent }, { role: "tool_results", results: [{ id: "provider-call-1", providerId: "provider-call-1", name: "get_vendor_profile", result: { legalName: "Ficticio" } }] }] });
    const body = JSON.parse(transport.mock.calls[1]![1].body);
    expect(body.contents[1]).toEqual({ role: "model", parts });
    expect(body.contents[2].parts[0].functionResponse.id).toBe("provider-call-1");
    expect(second).toMatchObject({ kind: "final", json: { documentKind: "INVOICE" } });
  });

  it("rechaza generación truncada conservando los tokens facturables conocidos", async () => {
    const provider = new GeminiProvider({ apiKey: "ficticia", model: "gemini-3.8-flash" }, vi.fn().mockResolvedValue(Response.json({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: '{}' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 7 } })));
    await expect(provider.generate(req)).rejects.toMatchObject({ code: "INVALID_RESPONSE", retryable: false, usage: { inputTokens: 10, outputTokens: 12 } });
  });

  it("cuenta listado y generaciones dentro de diez solicitudes sin sobrepasarlas", async () => {
    const transport = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ models: [] })));
    const session = boundedGeminiFetch("clave-ficticia", transport);
    for (let i = 0; i < 10; i++) await session.fetch("https://generativelanguage.googleapis.com/v1beta/models");
    await expect(session.fetch("https://generativelanguage.googleapis.com/v1beta/models")).rejects.toMatchObject({ retryable: false });
    expect(transport).toHaveBeenCalledTimes(10);
    expect(session.requests).toBe(10);
  });

  it.each([400, 401, 403, 429, 503])("HTTP %s cierra el circuito sin retries ni una segunda llamada", async (status) => {
    const transport = vi.fn().mockResolvedValue(new Response(null, { status }));
    const session = boundedGeminiFetch("clave-ficticia", transport);
    await expect(session.fetch("https://generativelanguage.googleapis.com/v1beta/models")).rejects.toMatchObject({ retryable: false });
    await expect(session.fetch("https://generativelanguage.googleapis.com/v1beta/models")).rejects.toMatchObject({ retryable: false });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(session.lastFailure).toEqual({ httpStatus: status });
  });

  it("el adaptador conserva el error AUTH permanente del transporte limitado", async () => {
    const transport = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    const bounded = boundedGeminiFetch("clave-ficticia", transport);
    const provider = new GeminiProvider({ apiKey: "clave-ficticia", model: "gemini-3.8-flash" }, bounded.fetch);
    await expect(provider.generate(req)).rejects.toMatchObject({ code: "AUTH", retryable: false });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("Google 400 API_KEY_INVALID se clasifica como autenticación y cierra el circuito", async () => {
    const transport = vi.fn().mockResolvedValue(Response.json({ error: { details: [{ reason: "API_KEY_INVALID" }], message: "No se debe registrar" } }, { status: 400 }));
    const session = boundedGeminiFetch("clave-ficticia", transport);
    await expect(session.fetch("https://generativelanguage.googleapis.com/v1beta/models")).rejects.toMatchObject({ code: "AUTH", retryable: false });
    await expect(session.fetch("https://generativelanguage.googleapis.com/v1beta/models")).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("rechaza redirecciones/destinos ajenos y API key en query antes de enviar", async () => {
    const transport = vi.fn();
    const session = boundedGeminiFetch("clave-ficticia", transport);
    await expect(session.fetch("https://example.com/v1beta/models")).rejects.toThrow();
    await expect(session.fetch("https://generativelanguage.googleapis.com/v1beta/models?key=no")).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });

  it("lista modelos estables sin inventar acceso cuando la página está truncada", async () => {
    const transport = vi.fn().mockResolvedValue(Response.json({ models: [{ name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-preview-flash" }], nextPageToken: "pagina-ficticia" }));
    expect(await listGeminiModels(transport)).toEqual({ models: [{ name: "models/gemini-3.8-flash", generateContent: true }], truncated: true });
  });
});

describe("Supabase/Graphile: guardias antes de cualquier operación remota", () => {
  it("preflight valida solo BD sin exigir secretos de IA ni Storage", () => {
    const env = parseDbConnectionEnv({ DATABASE_URL: "postgres://u:p@localhost:5432/local", AI_PROVIDER: "gemini", STORAGE_DRIVER: "supabase" });
    expect(env.DATABASE_SSL).toBe("disable");
    expect(() => parseDbConnectionEnv({ DATABASE_URL: "invalida" })).toThrow(/DATABASE_URL/);
  });
  it("admite directo/session y rechaza transaction pooling", () => {
    expect(() => assertSessionConnection("postgres://u:p@db.proyecto.supabase.co:5432/postgres")).not.toThrow();
    expect(() => assertSessionConnection("postgres://u.proyecto:p@aws-0-region.pooler.supabase.com:5432/postgres")).not.toThrow();
    expect(() => assertSessionConnection("postgres://u.proyecto:p@aws-0-region.pooler.supabase.com:6543/postgres")).toThrow(/Session/);
    expect(() => assertSessionConnection("postgres://u:p@remote.example:5432/postgres?pgbouncer=true")).toThrow();
  });
  it("la inicialización perezosa de la API tampoco puede migrar Graphile remoto sin confirmación", async () => {
    const pool = { options: { connectionString: "postgres://u:clave-ficticia@db.proyecto.supabase.co:5432/postgres" }, query: vi.fn() };
    const queue = createJobQueue(pool as unknown as pg.Pool, silentLogger);
    await expect(queue.addJob("system_ping", { note: "prueba" })).rejects.toThrow(/api-queue/);
    expect(pool.query).not.toHaveBeenCalled();
    await queue.release();
  });
});
