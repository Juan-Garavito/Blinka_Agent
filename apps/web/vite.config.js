import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Same-origin: el navegador solo habla con este origen; Vite reenvía /api a
 * Express en desarrollo (cookies HttpOnly de sesión sin CORS ni subdominios).
 * En producción Express sirve este build (ver README).
 */
const API = process.env.BLINKA_API_URL ?? "http://127.0.0.1:4000";
const proxy = Object.fromEntries(["/api", "/health", "/ready", "/openapi.json"].map((p) => [p, { target: API, changeOrigin: false }]));

export default defineConfig({
  plugins: [react()],
  server: { host: "localhost", port: 5173, strictPort: true, proxy },
  preview: { host: "localhost", port: 4173, proxy },
  build: { sourcemap: true, target: "es2022" },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.js"],
    include: ["test/**/*.test.{js,jsx}"],
    css: { modules: { classNameStrategy: "non-scoped" } },
  },
});
