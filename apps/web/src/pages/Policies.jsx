import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Money } from "../components/Money.jsx";
import { Button, ConfirmDialog, EmptyState, ErrorPanel, Field, KeyValue, Notice, PageHeader, Skeleton, useToast } from "../components/ui.jsx";
import { IconClose, IconFlask, IconPlus } from "../components/icons.jsx";
import { api } from "../lib/api.js";
import { useResource } from "../lib/hooks.js";
import { formatDateTime, trimZeros } from "../lib/format.js";
import { useSession } from "../lib/session.jsx";
import m from "./manage.module.css";

const MONEY = /^\d{1,16}(\.\d{1,4})?$/;
const SCOPE = { COMPANY: "Empresa", CATEGORY: "Categoría", VENDOR: "Proveedor", CONTRACT: "Contrato" };
/** Compara importes decimales como BigInt escalado (sin coma flotante). */
const scaled = (v) => {
  const [i, f = ""] = v.split(".");
  return BigInt(i + f.padEnd(4, "0").slice(0, 4));
};

export default function Policies() {
  const { id } = useParams();
  const navigate = useNavigate();
  const list = useResource("/api/policies");
  const personas = useResource("/api/approval-personas");
  const categories = useResource("/api/categories");
  const vendors = useResource("/api/vendors");
  const contracts = useResource("/api/contracts");
  const [creating, setCreating] = useState(false);
  const target = (p) =>
    p.scopeLevel === "COMPANY"
      ? "Toda la empresa"
      : p.scopeLevel === "CATEGORY"
        ? categories.data?.categories.find((c) => c.id === p.categoryId)?.name
        : p.scopeLevel === "VENDOR"
          ? vendors.data?.vendors.find((v) => v.id === p.vendorId)?.legalName
          : contracts.data?.contracts.find((c) => c.id === p.contractId)?.contractRef;

  return (
    <>
      <PageHeader
        eyebrow="Gestión"
        title="Políticas"
        actions={
          !creating && (
            <Button icon={IconPlus} onClick={() => setCreating(true)}>
              Nueva política
            </Button>
          )
        }
      >
        Límites de autorización automática, topes absolutos y matriz de aprobación. Cada cambio crea una versión inmutable; las corridas registran qué versión aplicaron.
      </PageHeader>
      {creating && (
        <NewPolicy
          lookups={{ categories, vendors, contracts, personas }}
          onCancel={() => setCreating(false)}
          onCreated={(pid) => {
            setCreating(false);
            list.reload();
            navigate(`/policies/${pid}`);
          }}
        />
      )}
      <div className={m.two}>
        <section aria-label="Listado de políticas">
          {list.error ? (
            <ErrorPanel error={list.error} onRetry={list.reload} />
          ) : !list.data ? (
            <Skeleton lines={5} />
          ) : list.data.policies.length === 0 ? (
            <EmptyState title="Sin políticas">Sin política configurada, el motor no autoriza (POLICY_CONFIGURED).</EmptyState>
          ) : (
            <div className="ledger-wrap">
              <table className="ledger stack">
                <thead>
                  <tr>
                    <th>Política</th>
                    <th>Alcance</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.policies.map((p) => (
                    <tr key={p.id} aria-current={p.id === id ? "true" : undefined} style={p.id === id ? { background: "#f3f8f8" } : undefined}>
                      <td className="primary-cell">
                        <Link to={`/policies/${p.id}`}>{p.name}</Link>
                        <span className="sub">{target(p) ?? "…"}</span>
                      </td>
                      <td>{SCOPE[p.scopeLevel]}</td>
                      <td>{p.active ? "Activa" : <span className="muted">Inactiva</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <section className={m.panel} style={{ marginTop: 24 }} aria-labelledby="per-h">
            <h2 id="per-h" className={m.panelTitle}>
              <IconFlask size={16} /> Personas aprobadoras (simuladas)
            </h2>
            {!personas.data ? (
              <Skeleton lines={2} />
            ) : (
              <ul className={m.mini}>
                {personas.data.personas.map((p) => (
                  <li key={p.id}>
                    <span>
                      <strong>{p.displayName}</strong> <span className="muted">· {p.designation}</span>
                    </span>
                    <span className="muted">{p.active ? "activa" : "inactiva"}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className={m.fine}>Personas ficticias: el evaluador registra su decisión simulada en Aprobaciones. Se administran en Configuración.</p>
          </section>
        </section>
        <section aria-label="Detalle de la política">
          {id ? <PolicyDetail id={id} personas={personas.data?.personas ?? []} onChanged={list.reload} /> : <EmptyState title="Selecciona una política">Verás sus versiones, límites y matriz de aprobación.</EmptyState>}
        </section>
      </div>
    </>
  );
}

function PolicyDetail({ id, personas, onChanged }) {
  const data = useResource(`/api/policies/${id}`);
  const base = useSession().company?.baseCurrency ?? "";
  const [adding, setAdding] = useState(false);
  const [toggle, setToggle] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (data.error) return <ErrorPanel error={data.error} onRetry={data.reload} />;
  if (!data.data) return <Skeleton lines={6} />;
  const { policy, versions } = data.data;
  const pName = (pid) => personas.find((p) => p.id === pid)?.displayName ?? pid.slice(0, 8);
  const latest = [...versions].sort((a, b) => b.versionNo - a.versionNo);

  const setActive = async () => {
    setBusy(true);
    try {
      await api(`/api/policies/${id}/active`, { method: "POST", body: { active: !policy.active } });
      toast(policy.active ? "Política desactivada." : "Política activada.");
      data.reload();
      onChanged();
      setToggle(false);
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={m.stack}>
      <div className={m.panel}>
        <div className={m.panelHead}>
          <h2 className={m.panelTitle}>{policy.name}</h2>
          <div className={m.actions}>
            <Button size="sm" variant={policy.active ? "danger" : "secondary"} onClick={() => setToggle(true)}>
              {policy.active ? "Desactivar" : "Activar"}
            </Button>
            {!adding && (
              <Button size="sm" icon={IconPlus} onClick={() => setAdding(true)}>
                Nueva versión
              </Button>
            )}
          </div>
        </div>
        <p className="muted">
          Alcance: {SCOPE[policy.scopeLevel]} · {policy.active ? "activa" : "inactiva"} · creada {formatDateTime(policy.createdAt)}
        </p>
      </div>
      {adding && (
        <VersionForm
          scope={policy.scopeLevel}
          personas={personas}
          initial={latest[0]}
          onCancel={() => setAdding(false)}
          onSubmit={async (version) => {
            await api(`/api/policies/${id}/versions`, { method: "POST", body: version });
            toast("Versión publicada. Las próximas evaluaciones la aplicarán.");
            setAdding(false);
            data.reload();
          }}
        />
      )}
      {latest.map((v, i) => (
        <article key={v.id} className={m.panel} style={i > 0 ? { opacity: 0.8 } : undefined}>
          <h3 className={m.panelTitle}>
            Versión {v.versionNo} {i === 0 && <span className="muted">· vigente</span>}
          </h3>
          <KeyValue
            columns={3}
            items={[
              ["Autorización automática hasta", v.autoApprovalLimitBase ? <Money value={v.autoApprovalLimitBase} currency={base} /> : "No definido"],
              ["Tope absoluto por factura", v.hardInvoiceCapBase ? <Money value={v.hardInvoiceCapBase} currency={base} /> : "No definido"],
              ["Vigente desde", formatDateTime(v.effectiveFrom)],
            ]}
          />
          {v.matrix.length > 0 && (
            <div className="ledger-wrap">
              <table className="ledger">
                <caption>Matriz de aprobación (importe en moneda base)</caption>
                <thead>
                  <tr>
                    <th className="num">Desde (excl.)</th>
                    <th className="num">Hasta (incl.)</th>
                    <th>Persona aprobadora (simulada)</th>
                  </tr>
                </thead>
                <tbody>
                  {v.matrix.map((r) => (
                    <tr key={r.id}>
                      <td className="num">
                        <Money value={r.minAmountExclusive} currency={base} />
                      </td>
                      <td className="num">{r.maxAmountInclusive ? <Money value={r.maxAmountInclusive} currency={base} /> : "sin límite"}</td>
                      <td>{pName(r.personaId)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      ))}
      <ConfirmDialog open={toggle} title={policy.active ? "Desactivar política" : "Activar política"} confirmLabel={policy.active ? "Desactivar" : "Activar"} tone={policy.active ? "danger" : "primary"} busy={busy} onConfirm={setActive} onCancel={() => setToggle(false)}>
        <p>{policy.active ? "Las próximas evaluaciones dejarán de aplicarla. Si no queda ninguna política aplicable, el motor no autorizará." : "Las próximas evaluaciones la aplicarán según su alcance."}</p>
      </ConfirmDialog>
    </div>
  );
}

function VersionForm({ scope, personas, initial, onSubmit, onCancel }) {
  const strip = trimZeros;
  const [auto, setAuto] = useState(strip(initial?.autoApprovalLimitBase));
  const [cap, setCap] = useState(strip(initial?.hardInvoiceCapBase));
  const [matrix, setMatrix] = useState(() => (initial?.matrix ?? []).map((r) => ({ min: strip(r.minAmountExclusive) || "0", max: strip(r.maxAmountInclusive), personaId: r.personaId })));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const errs = {};
  if (auto && !MONEY.test(auto)) errs.auto = "Importe decimal (punto, hasta 4 decimales).";
  if (cap && !MONEY.test(cap)) errs.cap = "Importe decimal (punto, hasta 4 decimales).";
  if (!errs.auto && !errs.cap && auto && cap && scaled(auto) > scaled(cap)) errs.auto = "No puede superar el tope absoluto.";
  matrix.forEach((r, i) => {
    if (!MONEY.test(r.min)) errs[`m${i}`] = "Importe «desde» inválido.";
    else if (r.max && (!MONEY.test(r.max) || scaled(r.max) <= scaled(r.min))) errs[`m${i}`] = "«Hasta» debe ser mayor que «desde».";
    else if (!r.personaId) errs[`m${i}`] = "Selecciona la persona.";
  });
  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errs).length || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ ...(auto ? { autoApprovalLimitBase: auto } : {}), ...(cap ? { hardInvoiceCapBase: cap } : {}), matrix: matrix.map((r) => ({ minAmountExclusive: r.min, ...(r.max ? { maxAmountInclusive: r.max } : {}), personaId: r.personaId })) });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <form className={`${m.panel} ${m.newPanel}`} onSubmit={submit} noValidate>
      <h3 className={m.panelTitle}>Nueva versión</h3>
      <div className={m.formGrid}>
        <Field label="Autorización automática hasta (moneda base)" error={touched ? errs.auto : null} hint="Por encima, requiere aprobación">
          {(p) => <input {...p} inputMode="decimal" value={auto} onChange={(e) => setAuto(e.target.value)} />}
        </Field>
        <Field label="Tope absoluto por factura (moneda base)" error={touched ? errs.cap : null} hint="Por encima, se bloquea (no aprobable)">
          {(p) => <input {...p} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} />}
        </Field>
      </div>
      {scope === "COMPANY" ? (
        <fieldset style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 16, display: "grid", gap: 10 }}>
          <legend style={{ fontWeight: 650, padding: "0 6px" }}>Matriz de aprobación</legend>
          {matrix.map((r, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.4fr auto", gap: 8, alignItems: "end" }}>
              <Field label="Desde (excl.)" error={touched ? errs[`m${i}`] : null}>
                {(p) => <input {...p} inputMode="decimal" value={r.min} onChange={(e) => setMatrix(matrix.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)))} />}
              </Field>
              <Field label="Hasta (incl.)">{(p) => <input {...p} inputMode="decimal" value={r.max} placeholder="sin límite" onChange={(e) => setMatrix(matrix.map((x, j) => (j === i ? { ...x, max: e.target.value } : x)))} />}</Field>
              <Field label="Persona (simulada)">
                {(p) => (
                  <select {...p} value={r.personaId} onChange={(e) => setMatrix(matrix.map((x, j) => (j === i ? { ...x, personaId: e.target.value } : x)))}>
                    <option value="">Selecciona…</option>
                    {personas.filter((x) => x.active).map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.displayName}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Button type="button" variant="ghost" size="sm" aria-label={`Quitar regla ${i + 1}`} onClick={() => setMatrix(matrix.filter((_, j) => j !== i))}>
                <IconClose size={16} />
              </Button>
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" icon={IconPlus} onClick={() => setMatrix([...matrix, { min: "0", max: "", personaId: "" }])}>
            Añadir regla
          </Button>
        </fieldset>
      ) : (
        <Notice tone="info">La matriz de aprobación se define en la política de alcance Empresa (P0).</Notice>
      )}
      {error && <ErrorPanel error={error} title="No se pudo publicar la versión" />}
      <div className={m.actions}>
        <Button type="submit" loading={busy}>
          Publicar versión
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function NewPolicy({ lookups, onCancel, onCreated }) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState("CATEGORY");
  const [targetId, setTargetId] = useState("");
  const [error, setError] = useState(null);
  const [touched, setTouched] = useState(false);
  const options =
    scope === "CATEGORY"
      ? (lookups.categories.data?.categories ?? []).map((c) => [c.id, c.name])
      : scope === "VENDOR"
        ? (lookups.vendors.data?.vendors ?? []).map((v) => [v.id, v.legalName])
        : scope === "CONTRACT"
          ? (lookups.contracts.data?.contracts ?? []).map((c) => [c.id, c.contractRef])
          : [];
  const headErr = !name.trim() ? "El nombre es obligatorio." : scope !== "COMPANY" && !targetId ? "Selecciona a qué aplica." : null;
  return (
    <div style={{ marginBottom: 24 }}>
      <div className={`${m.panel}`} style={{ marginBottom: 12 }}>
        <h2 className={m.panelTitle}>Nueva política</h2>
        <div className={m.formGrid}>
          <Field label="Nombre" required error={touched && !name.trim() ? "Obligatorio." : null}>
            {(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />}
          </Field>
          <Field label="Alcance" required>
            {(p) => (
              <select {...p} value={scope} onChange={(e) => { setScope(e.target.value); setTargetId(""); }}>
                {Object.entries(SCOPE).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {scope !== "COMPANY" && (
            <Field label={`Aplica a (${SCOPE[scope].toLowerCase()})`} required error={touched && !targetId ? "Selecciona." : null}>
              {(p) => (
                <select {...p} value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                  <option value="">Selecciona…</option>
                  {options.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
        </div>
        {error && <ErrorPanel error={error} title="No se pudo crear la política" />}
      </div>
      <VersionForm
        scope={scope}
        personas={lookups.personas.data?.personas ?? []}
        onCancel={onCancel}
        onSubmit={async (version) => {
          setTouched(true);
          if (headErr) throw Object.assign(new Error(headErr), { message: headErr });
          const key = { CATEGORY: "categoryId", VENDOR: "vendorId", CONTRACT: "contractId" }[scope];
          try {
            const res = await api("/api/policies", { method: "POST", body: { name: name.trim(), scopeLevel: scope, ...(key ? { [key]: targetId } : {}), version } });
            onCreated(res.policy.id);
          } catch (e) {
            setError(e);
            throw e;
          }
        }}
      />
    </div>
  );
}
