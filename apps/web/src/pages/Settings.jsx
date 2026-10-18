import { useState } from "react";
import { Button, ErrorPanel, Field, KeyValue, PageHeader, Skeleton, useToast } from "../components/ui.jsx";
import { IconFlask, IconPlus } from "../components/icons.jsx";
import { api } from "../lib/api.js";
import { useResource } from "../lib/hooks.js";
import m from "./manage.module.css";

export default function Settings() {
  const company = useResource("/api/companies/current");
  const env = useResource("/api/system/environment");
  const categories = useResource("/api/categories");
  const personas = useResource("/api/approval-personas");
  const c = company.data?.company;
  const e = env.data;

  return (
    <>
      <PageHeader eyebrow="Gestión" title="Configuración">
        Datos de la empresa, entorno de ejecución y catálogos usados por el motor.
      </PageHeader>
      <div className={m.two}>
        <div className={m.stack}>
          <section className={m.panel} aria-labelledby="co-h">
            <h2 id="co-h" className={m.panelTitle}>
              Empresa
            </h2>
            {company.error ? (
              <ErrorPanel error={company.error} />
            ) : !c ? (
              <Skeleton lines={3} />
            ) : (
              <KeyValue
                columns={3}
                items={[
                  ["Nombre", c.name],
                  ["Moneda base", c.baseCurrency],
                  ["Zona horaria (período de autorización)", c.timezone],
                ]}
              />
            )}
            <div className={m.unavailable}>
              <strong>Solo lectura en P0.</strong> El backend no expone un endpoint para editar la empresa (sería <code>PATCH /api/companies/current</code>); la moneda base y la zona horaria se fijan en el seed local.
            </div>
          </section>
          <Catalog
            title="Categorías de gasto"
            data={categories}
            items={categories.data?.categories ?? []}
            render={(x) => (
              <>
                <span>
                  <strong>{x.name}</strong> <span className="muted mono">{x.code}</span>
                </span>
              </>
            )}
            patchPath={(x) => `/api/categories/${x.id}`}
            fields={[
              ["code", "Código", (v) => /^[A-Za-z0-9_-]{2,40}$/.test(v.trim()) || "2–40 letras, números, _ o -"],
              ["name", "Nombre", (v) => v.trim().length > 0 || "Obligatorio"],
            ]}
            createPath="/api/categories"
          />
        </div>
        <div className={m.stack}>
          <section className={m.panel} aria-labelledby="env-h">
            <h2 id="env-h" className={m.panelTitle}>
              Entorno de ejecución
            </h2>
            {!e ? (
              <Skeleton lines={4} />
            ) : (
              <KeyValue
                columns={1}
                items={[
                  ["Extracción IA", <Flag key="ai" sim={e.ai.simulated} text={`${e.ai.provider} · ${e.ai.model}`} />],
                  ["Tipo de cambio", <Flag key="fx" sim={e.fx.simulated} text={e.fx.provider} />],
                  ["Almacenamiento de documentos", e.storage.driver === "local" ? "Local (disco privado del servidor)" : e.storage.driver],
                  ["Pagos", <Flag key="pay" sim text={e.payments.note} />],
                ]}
              />
            )}
            <p className={m.fine}>Informado por el backend (/api/system/environment). Las integraciones reales (Gemini, Frankfurter, Supabase) solo se activan por configuración del servidor.</p>
          </section>
          <Catalog
            title="Personas aprobadoras (simuladas)"
            icon={IconFlask}
            data={personas}
            items={personas.data?.personas ?? []}
            render={(x) => (
              <span>
                <strong>{x.displayName}</strong> <span className="muted">· {x.designation}</span>
              </span>
            )}
            patchPath={(x) => `/api/approval-personas/${x.id}`}
            fields={[
              ["displayName", "Nombre (ficticio)", (v) => v.trim().length > 0 || "Obligatorio"],
              ["designation", "Cargo", (v) => v.trim().length > 0 || "Obligatorio"],
            ]}
            createPath="/api/approval-personas"
          />
        </div>
      </div>
    </>
  );
}

function Flag({ sim, text }) {
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      {sim && <span style={{ fontSize: 11, fontWeight: 700, padding: "0 6px", borderRadius: 4, background: "#fbf1e3", color: "#8a5a00", textTransform: "uppercase" }}>Simulado</span>}
      {text}
    </span>
  );
}

/** Catálogo con alta y activación/desactivación (PATCH { active }). */
function Catalog({ title, icon: Icon, data, items, render, patchPath, fields, createPath }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(() => Object.fromEntries(fields.map(([k]) => [k, ""])));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const errs = Object.fromEntries(fields.map(([k, , check]) => [k, check(form[k]) === true ? null : check(form[k])]));
  const toggle = async (x) => {
    setBusy(x.id);
    try {
      await api(patchPath(x), { method: "PATCH", body: { active: !x.active } });
      data.reload();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(null);
    }
  };
  const create = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (Object.values(errs).some(Boolean) || busy) return;
    setBusy("new");
    setError(null);
    try {
      await api(createPath, { method: "POST", body: Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()])) });
      toast("Registro creado.");
      setForm(Object.fromEntries(fields.map(([k]) => [k, ""])));
      setAdding(false);
      setTouched(false);
      data.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className={m.panel}>
      <div className={m.panelHead}>
        <h2 className={m.panelTitle}>
          {Icon && <Icon size={16} />} {title}
        </h2>
        {!adding && (
          <Button size="sm" variant="ghost" icon={IconPlus} onClick={() => setAdding(true)}>
            Añadir
          </Button>
        )}
      </div>
      {data.error ? (
        <ErrorPanel error={data.error} onRetry={data.reload} />
      ) : !data.data ? (
        <Skeleton lines={3} />
      ) : (
        <ul className={m.mini}>
          {items.map((x) => (
            <li key={x.id} style={x.active ? undefined : { opacity: 0.6 }}>
              {render(x)}
              <Button size="sm" variant="ghost" loading={busy === x.id} onClick={() => toggle(x)}>
                {x.active ? "Desactivar" : "Activar"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <form onSubmit={create} noValidate style={{ display: "grid", gap: 12, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
          <div className={m.formGrid}>
            {fields.map(([k, label]) => (
              <Field key={k} label={label} required error={touched ? errs[k] : null}>
                {(p) => <input {...p} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />}
              </Field>
            ))}
          </div>
          {error && <ErrorPanel error={error} title="No se pudo crear" />}
          <div className={m.actions}>
            <Button type="submit" size="sm" loading={busy === "new"}>
              Guardar
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
