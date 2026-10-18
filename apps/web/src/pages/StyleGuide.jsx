import { useState } from "react";
import { BUSINESS_STATUS, StatusBadge, TechBadge } from "../components/StatusBadge.jsx";
import { VENDOR_STATUS, VendorStatusBadge } from "../components/VendorStatus.jsx";
import { Money } from "../components/Money.jsx";
import { Button, ConfirmDialog, EmptyState, ErrorPanel, Field, KeyValue, Notice, PageHeader, Skeleton } from "../components/ui.jsx";
import { IconAlert, IconFlask, IconPlus, IconRefresh } from "../components/icons.jsx";
import { RunProgress } from "./invoices/detail/RunProgress.jsx";
import s from "./StyleGuide.module.css";

const COLORS = [
  ["--brand-navy", "#153454", "Principal"],
  ["--brand-navy-deep", "#0E293F", "Profundo"],
  ["--brand-petrol", "#0D6871", "Acento / progreso"],
  ["--brand-gold", "#D6A357", "Evidencia / demo"],
  ["--canvas", "#F7F9FB", "Fondo"],
  ["--line", "#DFE7EC", "Líneas 1 px"],
  ["--ink", "#172A3C", "Texto"],
  ["--muted", "#5D6E80", "Secundario"],
];
const DEMO_RUN = {
  runNo: 2,
  processing: "validating",
  stages: [
    { stage: "EXTRACT_CLASSIFY", status: "SUCCEEDED", reused: true, startedAt: "2026-10-18T10:00:00Z", finishedAt: "2026-10-18T10:00:01Z" },
    { stage: "CONTRACT_MATCH", status: "SUCCEEDED", reused: false, startedAt: "2026-10-18T10:00:01Z", finishedAt: "2026-10-18T10:00:01.400Z" },
    { stage: "CONTRACT_VALIDATE", status: "RUNNING", reused: false, startedAt: "2026-10-18T10:00:02Z", finishedAt: null },
  ],
};

/** Catálogo de componentes (NO es el Dashboard). Datos de ejemplo ficticios, sin llamadas a la API. */
export default function StyleGuide() {
  const [dlg, setDlg] = useState(false);
  return (
    <>
      <PageHeader eyebrow="Sistema visual · Blinka Precision Interface" title="Guía de componentes">
        Catálogo de patrones reutilizables con datos de ejemplo <strong>ficticios</strong>. Las pantallas reales usan solo lo que su tarea necesita.
      </PageHeader>
      <Section title="Color">
        <div className={s.swatches}>
          {COLORS.map(([v, hex, use]) => (
            <div key={v} className={s.swatch}>
              <span style={{ background: `var(${v})` }} />
              <strong>{use}</strong>
              <code>
                {v} · {hex}
              </code>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Tipografía">
        <p className={s.display}>Manrope · títulos editoriales</p>
        <p>Inter · interfaz y texto de lectura, 15 px base.</p>
        <p className="num">Cifras tabulares: 1.234.567,89 USD · 0,000315411644</p>
        <p className="eyebrow">Eyebrow · contexto</p>
      </Section>
      <Section title="Estados de negocio y técnicos">
        <div className={s.row}>
          {Object.keys(BUSINESS_STATUS).map((k) => (
            <StatusBadge key={k} status={k} />
          ))}
        </div>
        <div className={s.row}>
          <TechBadge kind="PROCESSING" />
          <TechBadge kind="NOT_EVALUATED" />
          {Object.keys(VENDOR_STATUS).map((k) => (
            <VendorStatusBadge key={k} status={k} />
          ))}
        </div>
        <p className="muted">Texto + icono + explicación (title/lector de pantalla); el color nunca es el único portador del significado. Los técnicos usan contorno discontinuo.</p>
      </Section>
      <Section title="Acciones">
        <div className={s.row}>
          <Button icon={IconPlus}>Primaria</Button>
          <Button variant="secondary">Secundaria</Button>
          <Button variant="petrol">Petróleo</Button>
          <Button variant="ghost">Fantasma</Button>
          <Button variant="danger">Destructiva</Button>
          <Button loading>Procesando</Button>
          <Button disabled>Deshabilitada</Button>
          <Button variant="secondary" onClick={() => setDlg(true)}>
            Abrir diálogo
          </Button>
        </div>
      </Section>
      <Section title="Formularios">
        <div className={s.formGrid}>
          <Field label="Campo obligatorio" required hint="Ayuda asociada por aria-describedby">
            {(p) => <input {...p} defaultValue="ALFA-2026-10-001" />}
          </Field>
          <Field label="Con error" error="El importe usa punto decimal y hasta 4 decimales.">
            {(p) => <input {...p} defaultValue="1.200,5" />}
          </Field>
          <Field label="Selección">
            {(p) => (
              <select {...p}>
                <option>USD</option>
                <option>EUR</option>
              </select>
            )}
          </Field>
        </div>
      </Section>
      <Section title="Avisos y estados de vista">
        <div className={s.stack}>
          <Notice tone="info" title="Información">Mensaje contextual.</Notice>
          <Notice tone="demo" icon={IconFlask}>
            Entorno simulado: IA FAKE (MOCK), FX FIXTURE, sin pagos reales.
          </Notice>
          <Notice tone="warning" icon={IconAlert} title="Advertencia">
            Proveedor pendiente de habilitación.
          </Notice>
          <ErrorPanel error={{ message: "Ejemplo de error del backend", code: "EXAMPLE_ERROR", requestId: "0f3a9c21-0000" }} onRetry={() => {}} />
          <EmptyState title="Sin resultados" action={<Button variant="secondary" icon={IconRefresh}>Reintentar</Button>}>
            Estado vacío con acción.
          </EmptyState>
          <Skeleton lines={3} />
        </div>
      </Section>
      <Section title="Datos">
        <div className="ledger-wrap">
          <table className="ledger stack">
            <thead>
              <tr>
                <th>Factura</th>
                <th>Estado</th>
                <th className="num">Importe</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="primary-cell">
                  EJEMPLO-001<span className="sub">Proveedor ficticio</span>
                </td>
                <td>
                  <StatusBadge status="AUTORIZADA" size="sm" />
                </td>
                <td className="num">
                  <Money value="1200.0000" currency="USD" />
                </td>
              </tr>
              <tr>
                <td className="primary-cell">
                  EJEMPLO-002<span className="sub">Proveedor ficticio</span>
                </td>
                <td>
                  <StatusBadge status="EN_CORRECCION" size="sm" />
                </td>
                <td className="num">
                  <Money value="4000000.00" currency="COP" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <KeyValue
          columns={3}
          items={[
            ["Clave", "Valor"],
            ["Moneda", "USD"],
            ["Total", <Money key="t" value="960.0000" currency="USD" strong />],
          ]}
        />
      </Section>
      <Section title="Progreso de análisis (etapas reales del worker)">
        <div style={{ maxWidth: 520 }}>
          <RunProgress run={DEMO_RUN} />
        </div>
      </Section>
      <ConfirmDialog open={dlg} title="Diálogo de confirmación" onConfirm={() => setDlg(false)} onCancel={() => setDlg(false)}>
        <p>Foco atrapado por &lt;dialog&gt; nativo; Escape cierra.</p>
      </ConfirmDialog>
    </>
  );
}

function Section({ title, children }) {
  return (
    <section className={s.section}>
      <h2>{title}</h2>
      <div className={s.body}>{children}</div>
    </section>
  );
}
