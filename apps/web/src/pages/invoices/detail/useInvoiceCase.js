import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router";
import { usePolling, useResource } from "../../../lib/hooks.js";

/**
 * Datos del expediente de una factura: detalle + versiones, evaluaciones (flujos/corridas/checks/reserva),
 * proveedor y, si hay un análisis en curso, polling REAL de su corrida hasta que termina.
 */
export function useInvoiceCase(id) {
  const [params] = useSearchParams();
  const detail = useResource(`/api/invoices/${id}`);
  const evals = useResource(`/api/invoices/${id}/evaluations`);
  const vendorId = detail.data?.invoice.vendorId;
  const vendor = useResource(vendorId ? `/api/vendors/${vendorId}` : null);

  const runs = useMemo(() => (evals.data?.flows ?? []).flatMap((f) => f.runs.map((r) => ({ ...r, flow: f }))), [evals.data]);
  const runningRun = runs.find((r) => r.status === "RUNNING");
  const decisionRun = useMemo(
    () => runs.filter((r) => r.status === "COMPLETED").sort((a, b) => new Date(b.evaluatedAt) - new Date(a.evaluatedAt))[0] ?? null,
    [runs],
  );
  // La corrida a seguir: la indicada tras iniciar un análisis (?run=) o la que el backend reporta RUNNING.
  const paramRun = params.get("run");
  const paramRunKnownDone = paramRun && runs.some((r) => r.id === paramRun && r.status !== "RUNNING");
  const trackedRunId = runningRun?.id ?? (paramRunKnownDone ? null : paramRun);
  const poll = usePolling(trackedRunId ? `/api/evaluation-runs/${trackedRunId}` : null, { isDone: (d) => d.terminal, intervalMs: 1500 });

  const reloadAll = useCallback(() => {
    detail.reload();
    evals.reload();
  }, [detail, evals]);

  // Al terminar la corrida seguida se recargan UNA vez los datos reales (decisión, versión extraída, reserva).
  const handled = useRef(null);
  useEffect(() => {
    if (poll.done && poll.data?.runId && handled.current !== poll.data.runId) {
      handled.current = poll.data.runId;
      reloadAll();
    }
  }, [poll.done, poll.data, reloadAll]);

  const versions = detail.data?.versions ?? [];
  const currentVersion = versions.find((v) => v.id === detail.data?.invoice.currentVersionId) ?? null;
  const processing = Boolean(trackedRunId) && !poll.done;

  return {
    id,
    detail,
    evals,
    vendor: vendor.data?.vendor ?? null,
    bankAccounts: vendor.data?.bankAccounts ?? null,
    invoice: detail.data?.invoice ?? null,
    versions,
    currentVersion,
    runs,
    decisionRun,
    status: evals.data?.status ?? null,
    reservation: evals.data?.reservation ?? null,
    trackedRunId,
    poll,
    processing,
    reloadAll,
  };
}
