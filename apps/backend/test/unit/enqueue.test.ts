import { describe, expect, it, vi } from "vitest";
import { systemPing } from "../../src/jobs/tasks/system-ping.js";
import { buildTaskList } from "../../src/jobs/catalog.js";
import { enqueue } from "../../src/jobs/enqueue.js";

describe("enqueue", () => {
  it("aplica el maxAttempts de la tarea, no el 25 por defecto de la librería", async () => {
    const addJob = vi.fn().mockResolvedValue({ id: "1" });
    await enqueue({ addJob }, "system_ping", { note: "hola" });
    expect(addJob).toHaveBeenCalledWith("system_ping", { note: "hola" }, { maxAttempts: 1 });
  });

  it("rechaza payloads inválidos antes de insertar en la cola", async () => {
    const addJob = vi.fn();
    // @ts-expect-error: payload deliberadamente inválido
    await expect(enqueue({ addJob }, "system_ping", { note: 42 })).rejects.toThrow();
    expect(addJob).not.toHaveBeenCalled();
  });

  it("el catálogo solo expone tareas conocidas", () => {
    expect(Object.keys(buildTaskList({ system_ping: systemPing }))).toEqual(["system_ping"]);
  });
});
