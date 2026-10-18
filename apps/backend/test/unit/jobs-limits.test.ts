import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { JobHelpers } from "graphile-worker";
import { MAX_TASK_ATTEMPTS, buildTaskList, defineTask } from "../../src/jobs/catalog.js";
import { systemPing } from "../../src/jobs/tasks/system-ping.js";
import { enqueue } from "../../src/jobs/enqueue.js";

describe("límites explícitos de reintentos", () => {
  it("ninguna tarea puede declarar el 25 por defecto ni superar el techo global", () => {
    const base = { payload: z.object({}), handler: () => undefined };
    expect(() => defineTask({ ...base, maxAttempts: 25 })).toThrow(/entre 1 y 5/);
    expect(() => defineTask({ ...base, maxAttempts: 0 })).toThrow();
    expect(() => defineTask({ ...base, maxAttempts: MAX_TASK_ATTEMPTS })).not.toThrow();
  });

  it("enqueue no permite ampliar el maxAttempts declarado por la tarea", async () => {
    const addJob = vi.fn();
    await expect(enqueue({ addJob }, "system_ping", {}, { maxAttempts: 25 })).rejects.toThrow(RangeError);
    expect(addJob).not.toHaveBeenCalled();
  });

  it("el worker descarta sin ejecutar un job cuyo intento supera el maxAttempts declarado", async () => {
    const error = vi.fn();
    const info = vi.fn();
    const helpers = { job: { id: "7", attempts: 2 }, logger: { error, info } } as unknown as JobHelpers;
    await buildTaskList({ system_ping: systemPing }).system_ping!({ note: "x" }, helpers);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/descartado/));
    expect(info).not.toHaveBeenCalled(); // el handler real no corrió
  });
});
