-- Garantías de integridad del dominio comercial que Drizzle no expresa.

-- 1. La versión actual de una factura debe pertenecer a esa misma factura.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_current_version_fk"
  FOREIGN KEY ("current_version_id", "id") REFERENCES "invoice_versions" ("id", "invoice_id") ON DELETE RESTRICT;
--> statement-breakpoint

-- 2. Vigencias de versiones CONFIRMED de un mismo contrato no pueden solaparse:
--    la selección de versión por fecha es determinista.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_no_overlap"
  EXCLUDE USING gist (
    "contract_id" WITH =,
    daterange("effective_from", "effective_to", '[]') WITH &&
  ) WHERE ("status" = 'CONFIRMED');
--> statement-breakpoint

-- 3. Inmutabilidad. Los documentos originales, las versiones y líneas de factura
--    y los eventos de auditoría nunca se modifican ni se borran.
CREATE FUNCTION "blinka_forbid_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% es inmutable: % no permitido', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation', CONSTRAINT = TG_TABLE_NAME || '_immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "documents_immutable" BEFORE UPDATE OR DELETE ON "documents"
  FOR EACH ROW EXECUTE FUNCTION "blinka_forbid_mutation"();
--> statement-breakpoint
CREATE TRIGGER "invoice_versions_immutable" BEFORE UPDATE OR DELETE ON "invoice_versions"
  FOR EACH ROW EXECUTE FUNCTION "blinka_forbid_mutation"();
--> statement-breakpoint
CREATE TRIGGER "invoice_lines_immutable" BEFORE UPDATE OR DELETE ON "invoice_lines"
  FOR EACH ROW EXECUTE FUNCTION "blinka_forbid_mutation"();
--> statement-breakpoint
CREATE TRIGGER "audit_events_append_only" BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION "blinka_forbid_mutation"();
--> statement-breakpoint

-- 4. Una versión de contrato solo cambia mientras es DRAFT (incluida la transición
--    DRAFT → CONFIRMED/REJECTED). Confirmada o rechazada, queda congelada.
CREATE FUNCTION "contract_versions_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'contract_versions % en estado % es inmutable', OLD.id, OLD.status
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'contract_versions_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.id <> OLD.id OR NEW.contract_id <> OLD.contract_id OR NEW.company_id <> OLD.company_id OR NEW.version_no <> OLD.version_no OR NEW.origin <> OLD.origin THEN
    RAISE EXCEPTION 'identidad de contract_versions no modificable'
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'contract_versions_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "contract_versions_guard" BEFORE UPDATE OR DELETE ON "contract_versions"
  FOR EACH ROW EXECUTE FUNCTION "contract_versions_guard"();
--> statement-breakpoint

-- 5. Los ítems solo se crean/modifican/borran mientras su versión es DRAFT.
CREATE FUNCTION "contract_items_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM contract_versions
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.contract_version_id ELSE NEW.contract_version_id END
    FOR SHARE;
  IF v_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'los ítems de una versión de contrato % no se modifican', coalesce(v_status, 'inexistente')
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'contract_items_immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.contract_version_id <> OLD.contract_version_id THEN
    RAISE EXCEPTION 'un ítem no cambia de versión' USING ERRCODE = 'restrict_violation', CONSTRAINT = 'contract_items_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "contract_items_guard" BEFORE INSERT OR UPDATE OR DELETE ON "contract_items"
  FOR EACH ROW EXECUTE FUNCTION "contract_items_guard"();
