import { Route, Routes, useLocation, useParams } from "react-router";
import { StatusBadge } from "../../components/StatusBadge.jsx";
import { Money } from "../../components/Money.jsx";
import { ErrorPanel, Notice, PageHeader, Skeleton, TabLinks } from "../../components/ui.jsx";
import { IconAlert } from "../../components/icons.jsx";
import { NotFound } from "../System.jsx";
import { useInvoiceCase } from "./detail/useInvoiceCase.js";
import Summary from "./detail/Summary.jsx";
import Investigation from "./detail/Investigation.jsx";
import EvidenceStudio from "./detail/EvidenceStudio.jsx";
import History from "./detail/History.jsx";
import Correction from "./detail/Correction.jsx";
import styles from "./detail/Detail.module.css";

/** Expediente de factura con pestañas DIRECCIONABLES: /invoices/:id, /investigation, /evidence, /history. */
export default function InvoiceDetail() {
  const { id } = useParams();
  const location = useLocation();
  const c = useInvoiceCase(id);
  const { invoice, currentVersion: v, detail } = c;

  if (detail.error?.status === 404 || detail.error?.code === "VALIDATION_ERROR") return <NotFound what="La factura no existe o no pertenece a tu empresa." />;
  if (detail.error) return <ErrorPanel error={detail.error} onRetry={detail.reload} title="No se pudo cargar la factura" />;
  if (!invoice) return <Skeleton lines={8} label="Cargando factura" />;

  const number = v?.supplierInvoiceNumber ?? null;
  const base = `/invoices/${id}`;
  const failingEvidence = c.decisionRun?.checks.filter((k) => k.ruleCode.startsWith("EVIDENCE_") && k.outcome !== "PASS").length ?? 0;
  const startError = location.state?.startError;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ to: "/invoices", label: "Facturas" }, { label: number ?? "Factura sin número" }]}
        eyebrow={c.vendor ? c.vendor.legalName : "Proveedor"}
        title={number ?? "Sin número extraído"}
        aside={c.status || c.processing ? <StatusBadge status={c.status} processing={c.processing} size="lg" withExplain /> : <StatusBadge status={null} size="lg" />}
        actions={
          v?.totalAmount && (
            <div className={styles.headAmount}>
              <span className="eyebrow">Total original</span>
              <Money value={v.totalAmount} currency={v.originalCurrency} strong className={styles.bigMoney} />
              {c.decisionRun?.amountBase && c.decisionRun.baseCurrency !== v.originalCurrency && (
                <span className="muted">
                  ≈ <Money value={c.decisionRun.amountBase} currency={c.decisionRun.baseCurrency} /> base
                </span>
              )}
            </div>
          )
        }
      />
      {startError && (
        <div className={styles.block}>
          <Notice tone="warning" icon={IconAlert} title="La factura se registró, pero el análisis no se inició">
            {startError.message} ({startError.code}). Puedes iniciarlo desde el resumen.
          </Notice>
        </div>
      )}
      <TabLinks
        label="Secciones del expediente"
        tabs={[
          { to: base, label: "Resumen", end: true },
          { to: `${base}/investigation`, label: "Investigación", badge: c.decisionRun ? c.decisionRun.checks.filter((k) => k.outcome !== "PASS").length || null : null },
          { to: `${base}/evidence`, label: "Evidencia", badge: failingEvidence || null },
          { to: `${base}/history`, label: "Historial", badge: c.versions.length > 1 ? c.versions.length : null },
        ]}
      />
      <div className={styles.tabBody}>
        <Routes>
          <Route index element={<Summary c={c} />} />
          <Route path="investigation" element={<Investigation c={c} />} />
          <Route path="evidence" element={<EvidenceStudio c={c} />} />
          <Route path="history" element={<History c={c} />} />
          <Route path="correct" element={<Correction c={c} />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
    </>
  );
}
