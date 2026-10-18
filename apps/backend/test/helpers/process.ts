import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { BACKEND_ROOT } from "./env.js";


export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => (typeof addr === "object" && addr ? resolve(addr.port) : reject(new Error("sin puerto"))));
    });
  });
}

export interface Spawned {
  child: ChildProcess;
  output: () => string;
  waitFor: (pattern: RegExp, timeoutMs?: number) => Promise<void>;
  exited: Promise<number | null>;
}

/**
 * Lanza un entrypoint TS con un entorno explícito (sin heredar .env).
 * `node --import tsx` resuelve tsx desde el workspace o la raíz del monorepo
 * y recibe las señales directamente.
 */
export function spawnEntrypoint(entry: string, env: Record<string, string>): Spawned {
  const child = spawn(process.execPath, ["--import", "tsx", entry], {
    cwd: BACKEND_ROOT,
    env: { PATH: process.env.PATH ?? "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  const listeners = new Set<() => void>();
  const onData = (chunk: Buffer) => {
    out += chunk.toString();
    listeners.forEach((l) => l());
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));

  return {
    child,
    output: () => out,
    exited,
    waitFor: (pattern, timeoutMs = 15000) =>
      new Promise((resolve, reject) => {
        const check = () => {
          if (pattern.test(out)) {
            listeners.delete(check);
            clearTimeout(timer);
            resolve();
          }
        };
        const timer = setTimeout(() => {
          listeners.delete(check);
          reject(new Error(`Timeout esperando ${pattern}. Salida:\n${out}`));
        }, timeoutMs);
        listeners.add(check);
        void exited.then(() => {
          if (!pattern.test(out)) {
            clearTimeout(timer);
            reject(new Error(`El proceso terminó antes de ${pattern}. Salida:\n${out}`));
          }
        });
        check();
      }),
  };
}
