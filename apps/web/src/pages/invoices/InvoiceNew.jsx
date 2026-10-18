import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { BILLING_TYPE, VENDOR_STATUS, VendorStatusBadge } from "../../components/VendorStatus.jsx";
import { Button, ButtonLink, ErrorPanel, Notice, PageHeader, Skeleton, useToast } from "../../components/ui.jsx";
import { IconAlert, IconCheck, IconClose, IconDoc, IconFlask, IconPlus, IconSearch, IconUpload } from "../../components/icons.jsx";
import { api, uploadFile } from "../../lib/api.js";
import { useResource } from "../../lib/hooks.js";
import { formatBytes } from "../../lib/format.js";
import styles from "./InvoiceNew.module.css";

export const ACCEPTED_TYPES = ["application/pdf", "image/png", "image/jpeg"];
/** Límite del backend (DOCUMENT_MAX_BYTES, 10 MB por defecto). El servidor lo vuelve a validar. */
export const MAX_BYTES = 10 * 1024 * 1024;

export function validateFile(file) {
  if (!file) return "Selecciona el documento de la factura.";
  if (!ACCEPTED_TYPES.includes(file.type)) return "Formato no admitido. Usa PDF, PNG o JPEG.";
  if (file.size === 0) return "El archivo está vacío.";
  if (file.size > MAX_BYTES) return `El archivo supera el máximo de ${formatBytes(MAX_BYTES)}.`;
  return null;
}

const STEPS = { idle: null, uploading: "Subiendo documento", registering: "Registrando factura", support: "Adjuntando soporte", starting: "Iniciando análisis" };

export default function InvoiceNew() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const vendors = useResource("/api/vendors");
  const contracts = useResource("/api/contracts");
  const [vendorId, setVendorId] = useState(params.get("vendorId") ?? "");
  const [file, setFile] = useState(null);
  const [support, setSupport] = useState(null);
  const [touched, setTouched] = useState(false);
  const [step, setStep] = useState("idle");
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const vendor = vendors.data?.vendors.find((v) => v.id === vendorId) ?? null;
  const vendorContracts = (contracts.data?.contracts ?? []).filter((c) => c.vendorId === vendorId && c.status === "ACTIVE");
  const hourly = vendorContracts.some((c) => c.billingType === "HOURLY");
  const fileError = file ? validateFile(file) : null;
  const supportError = support ? validateFile(support) : null;
  const busy = step !== "idle";
  const canSubmit = vendor && file && !fileError && !supportError && !busy;

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    setError(null);
    let invoiceId = null;
    try {
      setStep("uploading");
      const up = uploadFile("/api/documents?kind=INVOICE", file, { onProgress: setProgress, headers: { "X-File-Name": encodeURIComponent(file.name) } });
      abortRef.current = up.abort;
      const doc = await up.promise;
      abortRef.current = null;
      if (doc.sameContentAsDocumentId) toast("Este archivo ya se había cargado antes: el motor verificará si es un duplicado.", "info");

      setStep("registering");
      const created = await api("/api/invoices", { method: "POST", body: { vendorId, documentId: doc.document.id } });
      invoiceId = created.invoice.id;

      if (support) {
        setStep("support");
        setProgress(null);
        const sup = uploadFile("/api/documents?kind=EVIDENCE", support, { onProgress: setProgress, headers: { "X-File-Name": encodeURIComponent(support.name) } });
        abortRef.current = sup.abort;
        const sdoc = await sup.promise;
        abortRef.current = null;
        await api(`/api/invoices/${invoiceId}/attachments`, { method: "POST", body: { documentId: sdoc.document.id, purpose: "TIMESHEET" } });
      }

      setStep("starting");
      const run = await api(`/api/invoices/${invoiceId}/analysis`, { method: "POST", body: {} });
      navigate(`/invoices/${invoiceId}?run=${run.runId}`, { state: { justCreated: true, textLayer: doc.textLayer } });
    } catch (err) {
      abortRef.current = null;
      setStep("idle");
      setProgress(null);
      if (invoiceId) {
        // La factura ya existe: no se repite la carga; el detalle permite reintentar el paso pendiente.
        toast("La factura quedó registrada, pero un paso posterior falló. Puedes reintentarlo desde su detalle.", "error");
        navigate(`/invoices/${invoiceId}`, { state: { startError: { code: err.code, message: err.message } } });
        return;
      }
      if (err.code !== "ABORTED") setError(err);
    }
  };

  return (
    <>
      <PageHeader
        breadcrumbs={[{ to: "/invoices", label: "Facturas" }, { label: "Nueva factura" }]}
        title="Nueva factura"
      >
        Asocia la factura a su proveedor y carga el documento original. El análisis comienza al confirmar; la decisión la toma el motor determinista, no la IA.
      </PageHeader>

      <form className={styles.layout} onSubmit={submit} noValidate aria-describedby="new-help">
        <div className={styles.steps}>
          <Section n={1} title="Proveedor" done={Boolean(vendor)}>
            <VendorPicker
              vendors={vendors}
              contracts={contracts.data?.contracts ?? []}
              value={vendorId}
              onChange={setVendorId}
              disabled={busy}
              error={touched && !vendor ? "Selecciona el proveedor que emitió la factura." : null}
            />
          </Section>

          <Section n={2} title="Documento de la factura" done={Boolean(file && !fileError)}>
            <Dropzone
              label="Documento de la factura"
              file={file}
              onFile={setFile}
              disabled={busy}
              error={fileError ?? (touched && !file ? "Selecciona el documento de la factura." : null)}
              progress={step === "uploading" ? progress : null}
            />
            <p className={styles.help} id="new-help">
              PDF con texto seleccionable, o imagen PNG/JPEG. Cada dato usado para decidir se coteja con el texto del original; en imágenes o PDF escaneados una persona deberá confirmar los campos.
            </p>
          </Section>

          {vendor && hourly && (
            <Section n={3} title="Soporte de horas (recomendado)" done={Boolean(support && !supportError)}>
              <p className={styles.help}>
                El proveedor tiene un contrato <strong>por horas</strong>. Adjunta la hoja de horas: si la política la exige y falta, el motor enviará la factura a corrección.
              </p>
              <Dropzone label="Hoja de horas" file={support} onFile={setSupport} disabled={busy} error={supportError} progress={step === "support" ? progress : null} compact />
            </Section>
          )}
        </div>

        <aside className={styles.summary} aria-label="Resumen de la carga">
          <h2>Resumen</h2>
          <dl>
            <div>
              <dt>Proveedor</dt>
              <dd>{vendor ? vendor.legalName : <span className="muted">Sin seleccionar</span>}</dd>
            </div>
            {vendor && (
              <div>
                <dt>Estado del proveedor</dt>
                <dd>
                  <VendorStatusBadge status={vendor.status} />
                </dd>
              </div>
            )}
            {vendor && (
              <div>
                <dt>Contratos activos</dt>
                <dd>{vendorContracts.length ? vendorContracts.map((c) => `${c.contractRef} · ${BILLING_TYPE[c.billingType] ?? c.billingType}`).join(", ") : <span className={styles.warnText}>Ninguno — la factura irá a corrección (sin contrato)</span>}</dd>
              </div>
            )}
            <div>
              <dt>Documento</dt>
              <dd>{file ? `${file.name} · ${formatBytes(file.size)}` : <span className="muted">Sin documento</span>}</dd>
            </div>
          </dl>

          {vendor && vendor.status !== "AUTHORIZED" && (
            <Notice tone={vendor.status === "BLOCKED" ? "danger" : "warning"} icon={IconAlert} title={`Proveedor ${VENDOR_STATUS[vendor.status].label.toLowerCase()}`}>
              {VENDOR_STATUS[vendor.status].consequence}
            </Notice>
          )}

          {error && <ErrorPanel error={error} title="No se pudo cargar la factura" />}

          <div className={styles.submitRow}>
            <Button type="submit" size="lg" loading={busy} disabled={busy}>
              {busy ? STEPS[step] : "Cargar y analizar"}
            </Button>
            {step === "uploading" || step === "support" ? (
              <Button type="button" variant="ghost" onClick={() => abortRef.current?.()}>
                Cancelar subida
              </Button>
            ) : (
              <ButtonLink to="/invoices" variant="ghost">
                Cancelar
              </ButtonLink>
            )}
          </div>
          <p className={styles.fine}>
            <IconFlask size={14} /> Extracción con IA simulada en este entorno. Autorización y reserva simuladas: no se ejecuta ningún pago.
          </p>
        </aside>
      </form>
    </>
  );
}

function Section({ n, title, done, children }) {
  return (
    <section className={styles.section} aria-labelledby={`step-${n}`}>
      <h2 id={`step-${n}`} className={styles.sectionTitle}>
        <span className={styles.stepNo} data-done={done || undefined} aria-hidden>
          {done ? <IconCheck size={14} /> : n}
        </span>
        {title}
        {done && <span className="visually-hidden"> (completo)</span>}
      </h2>
      {children}
    </section>
  );
}

/** Selector de proveedor: búsqueda + grupo de radios nativos (accesible con teclado y lector). */
export function VendorPicker({ vendors, contracts, value, onChange, disabled, error }) {
  const [q, setQ] = useState("");
  const id = useId();
  const list = useMemo(() => {
    const all = vendors.data?.vendors ?? [];
    const needle = q.trim().toLowerCase();
    const order = { AUTHORIZED: 0, PENDING: 1, BLOCKED: 2 };
    return all
      .filter((v) => !needle || v.legalName.toLowerCase().includes(needle) || (v.taxReference ?? "").includes(needle))
      .sort((a, b) => order[a.status] - order[b.status] || a.legalName.localeCompare(b.legalName));
  }, [vendors.data, q]);
  const count = (vid) => contracts.filter((c) => c.vendorId === vid && c.status === "ACTIVE").length;

  if (vendors.error) return <ErrorPanel error={vendors.error} onRetry={vendors.reload} title="No se pudieron cargar los proveedores" />;
  if (!vendors.data) return <Skeleton lines={4} label="Cargando proveedores" />;
  return (
    <div className={styles.picker}>
      <div className={styles.pickerTop}>
        <label className={styles.search}>
          <IconSearch size={16} />
          <span className="visually-hidden">Buscar proveedor</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por razón social o NIT" disabled={disabled} />
        </label>
        <ButtonLink to={`/vendors?new=1&returnTo=${encodeURIComponent("/invoices/new")}`} variant="secondary" size="sm" icon={IconPlus}>
          Registrar proveedor
        </ButtonLink>
      </div>
      <fieldset className={styles.vendorList} aria-describedby={error ? `${id}-err` : undefined} aria-invalid={error ? true : undefined} disabled={disabled}>
        <legend className="visually-hidden">Proveedor que emitió la factura (obligatorio)</legend>
        {list.length === 0 && <p className={styles.none}>Ningún proveedor coincide con “{q}”.</p>}
        {list.map((v) => (
          <label key={v.id} className={styles.vendor} data-checked={v.id === value || undefined}>
            <input type="radio" name="vendor" value={v.id} checked={v.id === value} onChange={() => onChange(v.id)} required />
            <span className={styles.vendorMain}>
              <strong>{v.legalName}</strong>
              <span className="muted">
                NIT {v.taxReference ?? "—"} · {count(v.id)} {count(v.id) === 1 ? "contrato activo" : "contratos activos"}
              </span>
            </span>
            <VendorStatusBadge status={v.status} />
          </label>
        ))}
      </fieldset>
      {error && (
        <p id={`${id}-err`} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Zona de carga: arrastrar o elegir; validación local de tipo/tamaño y progreso REAL de subida. */
export function Dropzone({ label, file, onFile, disabled, error, progress, compact = false }) {
  const inputId = useId();
  const [over, setOver] = useState(false);
  const preview = usePreviewUrl(file);
  const pct = progress?.total ? Math.round((progress.loaded / progress.total) * 100) : null;

  if (file) {
    return (
      <div className={styles.fileCard} data-invalid={error ? true : undefined}>
        {preview ? <img src={preview} alt="" className={styles.thumb} /> : <IconDoc size={28} />}
        <div className={styles.fileMeta}>
          <strong>{file.name}</strong>
          <span className="muted">
            {file.type === "application/pdf" ? "PDF" : file.type.replace("image/", "").toUpperCase()} · {formatBytes(file.size)}
          </span>
          {pct !== null && (
            <div className={styles.progress} role="progressbar" aria-label={`Subiendo ${label}`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${pct}%` }} />
            </div>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>
        {!disabled && (
          <button type="button" className={styles.remove} onClick={() => onFile(null)} aria-label={`Quitar ${file.name}`}>
            <IconClose size={16} />
          </button>
        )}
      </div>
    );
  }
  return (
    <>
      <label
        htmlFor={inputId}
        className={`${styles.drop} ${compact ? styles.dropCompact : ""}`}
        data-over={over || undefined}
        data-invalid={error ? true : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!disabled && e.dataTransfer.files?.[0]) onFile(e.dataTransfer.files[0]);
        }}
      >
        <IconUpload size={compact ? 20 : 26} />
        <span>
          <strong>Arrastra el archivo aquí</strong> o <u>elígelo de tu equipo</u>
        </span>
        <span className="muted">PDF, PNG o JPEG · máximo {formatBytes(MAX_BYTES)}</span>
        <input
          id={inputId}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          className="visually-hidden"
          disabled={disabled}
          aria-label={label}
          onChange={(e) => {
            onFile(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
      </label>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function usePreviewUrl(file) {
  const isImage = Boolean(file && file.type.startsWith("image/") && file.size <= MAX_BYTES);
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!isImage) return undefined;
    const u = URL.createObjectURL(file);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza un recurso externo (object URL) con su liberación
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file, isImage]);
  return isImage ? url : null;
}

