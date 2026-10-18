import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { sanitizeFileName, sniffMimeType } from "../../src/modules/documents/file-validation.js";
import { classifySupabaseKey, LocalDocumentStorage, StorageError, SupabaseDocumentStorage, supabaseServerAuthHeaders } from "../../src/modules/documents/storage.js";
import { JPEG_BYTES, PDF_BYTES, PNG_BYTES } from "../helpers/fixtures.js";

const KEY = "companies/0b1a0000-0000-4000-8000-000000000001/documents/11111111-2222-4333-8444-555555555555";

describe("validación de archivos", () => {
  it("detecta el tipo real por magic bytes", () => {
    expect(sniffMimeType(PDF_BYTES)).toBe("application/pdf");
    expect(sniffMimeType(PNG_BYTES)).toBe("image/png");
    expect(sniffMimeType(JPEG_BYTES)).toBe("image/jpeg");
    expect(sniffMimeType(Buffer.from("<?xml version='1.0'?><factura/>"))).toBeUndefined();
    expect(sniffMimeType(Buffer.from("MZ\x90\x00 ejecutable"))).toBeUndefined();
    expect(sniffMimeType(Buffer.alloc(0))).toBeUndefined();
  });

  it("sanea nombres: sin rutas, controles ni extensiones engañosas", () => {
    expect(sanitizeFileName("../../etc/passwd", "application/pdf")).toBe("passwd.pdf");
    expect(sanitizeFileName("C:\\Users\\x\\factura.PDF", "application/pdf")).toBe("factura.PDF");
    expect(sanitizeFileName("factura.pdf.exe", "application/pdf")).toBe("factura.pdf.pdf");
    expect(sanitizeFileName("a\u0000b\u202e<script>.pdf", "application/pdf")).toBe("ab_script_.pdf");
    expect(sanitizeFileName("", "image/png")).toBe("documento.png");
    expect(sanitizeFileName("...", "image/jpeg")).toBe("documento.jpg");
    expect(sanitizeFileName("x".repeat(500), "application/pdf")).toHaveLength(120);
    expect(sanitizeFileName("Factura nº 12 (abril).pdf", "application/pdf")).toBe("Factura nº 12 (abril).pdf");
  });
});

describe("almacenamiento local privado", () => {
  it("guarda bajo la clave del backend y no sobrescribe", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "blinka-st-"));
    const s = new LocalDocumentStorage(dir);
    await s.put(KEY, PDF_BYTES);
    expect((await s.get(KEY)).equals(PDF_BYTES)).toBe(true);
    await expect(s.put(KEY, PNG_BYTES)).rejects.toThrow();
    expect(readdirSync(dir)).toEqual(["companies"]);
  });

  it("rechaza claves con traversal o formato libre", async () => {
    const s = new LocalDocumentStorage(mkdtempSync(path.join(tmpdir(), "blinka-st-")));
    for (const bad of ["../../etc/passwd", "companies/../../x", `${KEY}/../../../../etc`, "/abs/path"]) {
      await expect(s.put(bad, PDF_BYTES)).rejects.toThrow(StorageError);
      await expect(s.get(bad)).rejects.toThrow(StorageError);
    }
  });
});

describe("adaptador Supabase Storage (fetch simulado; NO verificado contra Supabase real)", () => {
  const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.firma-ficticia`;
  const cfg = { url: "https://proyecto.supabase.co", serviceRoleKey: jwt("service_role"), bucket: "blinka-documents" };

  it("claves nuevas sb_secret_: solo cabecera apikey (no son JWT); service_role heredada: Bearer + apikey", async () => {
    const secret = "sb_secret_ficticia_0123456789abcdef";
    expect(classifySupabaseKey(secret)).toBe("secret");
    expect(classifySupabaseKey("sb_publishable_ficticia_0123")).toBe("publishable");
    expect(classifySupabaseKey(jwt("service_role"))).toBe("legacy_service_role");
    expect(classifySupabaseKey(jwt("anon"))).toBe("legacy_anon_or_other");
    expect(supabaseServerAuthHeaders(secret)).toEqual({ apikey: secret });
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await new SupabaseDocumentStorage({ ...cfg, serviceRoleKey: secret }, fetchMock).put(KEY, PDF_BYTES, "application/pdf");
    const headers = (fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers.apikey).toBe(secret);
    expect(headers.authorization).toBeUndefined();
  });

  it("sube al bucket privado sin upsert y con la clave de servicio solo en cabeceras", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await new SupabaseDocumentStorage(cfg, fetchMock).put(KEY, PDF_BYTES, "application/pdf");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://proyecto.supabase.co/storage/v1/object/blinka-documents/${KEY}`);
    expect(url).not.toContain(cfg.serviceRoleKey);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ authorization: `Bearer ${cfg.serviceRoleKey}`, "x-upsert": "false", "content-type": "application/pdf" });
  });

  it("firma URLs temporales y no filtra la clave en errores", async () => {
    const ok = vi.fn().mockResolvedValue(Response.json({ signedURL: `/object/sign/blinka-documents/${KEY}?token=abc` }));
    const url = await new SupabaseDocumentStorage(cfg, ok).createSignedUrl(KEY, 60);
    expect(url).toBe(`https://proyecto.supabase.co/storage/v1/object/sign/blinka-documents/${KEY}?token=abc`);
    expect(JSON.parse((ok.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual({ expiresIn: 60 });

    const fail = vi.fn().mockResolvedValue(new Response("denied", { status: 403 }));
    const err = await new SupabaseDocumentStorage(cfg, fail).get(KEY).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect(String(err)).not.toContain(cfg.serviceRoleKey);
  });
});
