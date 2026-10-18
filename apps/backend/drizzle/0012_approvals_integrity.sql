-- Una solicitud resuelta (APPROVED/REJECTED/SUPERSEDED) es histórica: no se modifica ni se borra.
CREATE FUNCTION "approval_requests_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'approval_requests % resuelta es inmutable', OLD.id
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'approval_requests_immutable';
  END IF;
  IF NEW.flow_id <> OLD.flow_id OR NEW.invoice_version_id <> OLD.invoice_version_id OR NEW.persona_id <> OLD.persona_id
     OR NEW.amount_base <> OLD.amount_base OR NEW.company_id <> OLD.company_id OR NEW.requested_by_run_id <> OLD.requested_by_run_id THEN
    RAISE EXCEPTION 'los términos de una solicitud de aprobación no se modifican'
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'approval_requests_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "approval_requests_guard" BEFORE UPDATE OR DELETE ON "approval_requests"
  FOR EACH ROW EXECUTE FUNCTION "approval_requests_guard"();
