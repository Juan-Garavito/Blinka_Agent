-- Garantías financieras en la propia base de datos (defensa en profundidad del DecisionEngine).

-- 1. Rangos de la matriz de aprobación sin solapes dentro de una versión de política.
ALTER TABLE "approval_matrix_rules" ADD CONSTRAINT "approval_matrix_rules_no_overlap"
  EXCLUDE USING gist (
    "policy_version_id" WITH =,
    numrange("min_amount_exclusive", "max_amount_inclusive", '(]') WITH &&
  ) WHERE ("active");
--> statement-breakpoint

-- 2. Registros inmutables (reutiliza blinka_forbid_mutation de 0005).
CREATE TRIGGER "policy_versions_immutable" BEFORE UPDATE OR DELETE ON "policy_versions"
  FOR EACH ROW EXECUTE FUNCTION "blinka_forbid_mutation"();
--> statement-breakpoint
CREATE TRIGGER "approval_matrix_rules_immutable" BEFORE UPDATE OR DELETE ON "approval_matrix_rules"
  FOR EACH ROW EXECUTE FUNCTION "blinka_forbid_mutation"();
--> statement-breakpoint
CREATE TRIGGER "fx_rate_snapshots_immutable" BEFORE UPDATE OR DELETE ON "fx_rate_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "blinka_forbid_mutation"();
--> statement-breakpoint
CREATE TRIGGER "budget_reservations_immutable" BEFORE UPDATE OR DELETE ON "budget_reservations"
  FOR EACH ROW EXECUTE FUNCTION "blinka_forbid_mutation"();
--> statement-breakpoint
CREATE TRIGGER "budget_allocations_immutable" BEFORE UPDATE OR DELETE ON "budget_reservation_allocations"
  FOR EACH ROW EXECUTE FUNCTION "blinka_forbid_mutation"();
--> statement-breakpoint
CREATE TRIGGER "evaluation_checks_immutable" BEFORE UPDATE OR DELETE ON "evaluation_checks"
  FOR EACH ROW EXECUTE FUNCTION "blinka_forbid_mutation"();
--> statement-breakpoint
CREATE TRIGGER "evaluation_applied_policies_immutable" BEFORE UPDATE OR DELETE ON "evaluation_applied_policies"
  FOR EACH ROW EXECUTE FUNCTION "blinka_forbid_mutation"();
--> statement-breakpoint
CREATE TRIGGER "invoice_attachments_immutable" BEFORE UPDATE OR DELETE ON "invoice_attachments"
  FOR EACH ROW EXECUTE FUNCTION "blinka_forbid_mutation"();
--> statement-breakpoint

-- 3. Las reglas de matriz solo se insertan en la misma transacción que publica su versión
--    (now() es constante dentro de una transacción): una versión publicada no cambia después.
CREATE FUNCTION "approval_matrix_rules_same_tx"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM policy_versions WHERE id = NEW.policy_version_id AND published_at = now()) THEN
    RAISE EXCEPTION 'la matriz de una versión de política publicada no se modifica'
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'approval_matrix_rules_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "approval_matrix_rules_same_tx" BEFORE INSERT ON "approval_matrix_rules"
  FOR EACH ROW EXECUTE FUNCTION "approval_matrix_rules_same_tx"();
--> statement-breakpoint

-- 4. Corridas: se finalizan una sola vez. Flujos: solo se cierran una vez. Ninguno se borra.
CREATE FUNCTION "evaluation_runs_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status <> 'RUNNING' THEN
    RAISE EXCEPTION 'evaluation_runs % ya finalizada es inmutable', OLD.id
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'evaluation_runs_immutable';
  END IF;
  IF NEW.flow_id <> OLD.flow_id OR NEW.invoice_version_id <> OLD.invoice_version_id OR NEW.run_no <> OLD.run_no OR NEW.company_id <> OLD.company_id THEN
    RAISE EXCEPTION 'identidad de evaluation_runs no modificable'
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'evaluation_runs_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "evaluation_runs_guard" BEFORE UPDATE OR DELETE ON "evaluation_runs"
  FOR EACH ROW EXECUTE FUNCTION "evaluation_runs_guard"();
--> statement-breakpoint
CREATE FUNCTION "evaluation_flows_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'evaluation_flows % cerrado es inmutable', OLD.id
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'evaluation_flows_immutable';
  END IF;
  IF NEW.invoice_id <> OLD.invoice_id OR NEW.company_id <> OLD.company_id THEN
    RAISE EXCEPTION 'identidad de evaluation_flows no modificable'
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'evaluation_flows_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "evaluation_flows_guard" BEFORE UPDATE OR DELETE ON "evaluation_flows"
  FOR EACH ROW EXECUTE FUNCTION "evaluation_flows_guard"();
--> statement-breakpoint

-- 5. Presupuestos en la moneda base de la empresa; no se borran.
CREATE FUNCTION "monthly_budgets_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'monthly_budgets no se borran' USING ERRCODE = 'restrict_violation', CONSTRAINT = 'monthly_budgets_immutable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = NEW.company_id AND base_currency = NEW.currency) THEN
    RAISE EXCEPTION 'la moneda del presupuesto debe ser la moneda base de la empresa'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'monthly_budgets_currency_is_base';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.company_id <> OLD.company_id OR NEW.period_yyyy_mm <> OLD.period_yyyy_mm OR NEW.scope <> OLD.scope
      OR NEW.category_id IS DISTINCT FROM OLD.category_id OR NEW.currency <> OLD.currency) THEN
    RAISE EXCEPTION 'identidad del presupuesto no modificable' USING ERRCODE = 'restrict_violation', CONSTRAINT = 'monthly_budgets_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "monthly_budgets_guard" BEFORE INSERT OR UPDATE OR DELETE ON "monthly_budgets"
  FOR EACH ROW EXECUTE FUNCTION "monthly_budgets_guard"();
--> statement-breakpoint

-- 6. La moneda base de una empresa no cambia una vez existen presupuestos (ER §A).
CREATE FUNCTION "companies_base_currency_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.base_currency <> OLD.base_currency AND EXISTS (SELECT 1 FROM monthly_budgets WHERE company_id = OLD.id) THEN
    RAISE EXCEPTION 'la moneda base no cambia con presupuestos existentes'
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'companies_base_currency_locked';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "companies_base_currency_guard" BEFORE UPDATE OF "base_currency" ON "companies"
  FOR EACH ROW EXECUTE FUNCTION "companies_base_currency_guard"();
--> statement-breakpoint

-- 7. Al confirmar la transacción: cada reserva tiene EXACTAMENTE dos asignaciones
--    (GLOBAL y CATEGORY) por el mismo importe, en presupuestos del mismo mes y empresa,
--    y su corrida autorizante decidió AUTHORIZE.
CREATE FUNCTION "budget_reservations_check_allocations"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  n_ok int;
  n_all int;
BEGIN
  SELECT count(*) FILTER (WHERE a.amount_base = NEW.reserved_amount_base AND b.period_yyyy_mm = NEW.period_yyyy_mm
                            AND b.company_id = NEW.company_id AND b.scope = a.scope),
         count(*)
    INTO n_ok, n_all
    FROM budget_reservation_allocations a JOIN monthly_budgets b ON b.id = a.monthly_budget_id
   WHERE a.reservation_id = NEW.id;
  IF n_all <> 2 OR n_ok <> 2 OR NOT EXISTS (
       SELECT 1 FROM budget_reservation_allocations WHERE reservation_id = NEW.id AND scope = 'GLOBAL')
     OR NOT EXISTS (SELECT 1 FROM budget_reservation_allocations WHERE reservation_id = NEW.id AND scope = 'CATEGORY') THEN
    RAISE EXCEPTION 'la reserva % requiere exactamente dos asignaciones GLOBAL y CATEGORY del mismo importe y mes', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'budget_reservations_two_allocations';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM evaluation_runs WHERE id = NEW.authorizing_run_id AND decision = 'AUTHORIZE' AND status = 'COMPLETED') THEN
    RAISE EXCEPTION 'la reserva % no tiene una corrida AUTHORIZE confirmada', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'budget_reservations_authorizing_run';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "budget_reservations_check_allocations"
  AFTER INSERT ON "budget_reservations" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "budget_reservations_check_allocations"();
--> statement-breakpoint

-- 8. Una corrida AUTHORIZE sin reserva vinculada no puede confirmarse (ER §D).
CREATE FUNCTION "evaluation_runs_authorize_requires_reservation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.decision = 'AUTHORIZE' AND NOT EXISTS (SELECT 1 FROM budget_reservations WHERE authorizing_run_id = NEW.id) THEN
    RAISE EXCEPTION 'la corrida % decide AUTHORIZE sin reserva confirmada', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'evaluation_runs_authorize_reservation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "evaluation_runs_authorize_requires_reservation"
  AFTER INSERT OR UPDATE OF "decision" ON "evaluation_runs" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "evaluation_runs_authorize_requires_reservation"();
