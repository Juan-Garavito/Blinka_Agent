-- Historia de ejecución de agentes: append-only / inmutable al terminar.
CREATE TRIGGER "evaluation_candidates_immutable" BEFORE UPDATE OR DELETE ON "evaluation_contract_candidates"
  FOR EACH ROW EXECUTE FUNCTION "blinka_forbid_mutation"();
--> statement-breakpoint
CREATE TRIGGER "evaluation_evidence_immutable" BEFORE UPDATE OR DELETE ON "evaluation_evidence"
  FOR EACH ROW EXECUTE FUNCTION "blinka_forbid_mutation"();
--> statement-breakpoint
CREATE TRIGGER "ai_usage_logs_append_only" BEFORE UPDATE OR DELETE ON "ai_usage_logs"
  FOR EACH ROW EXECUTE FUNCTION "blinka_forbid_mutation"();
--> statement-breakpoint
-- Un intento de etapa solo cambia mientras está QUEUED/RUNNING; terminado es histórico.
CREATE FUNCTION "agent_stage_runs_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status NOT IN ('QUEUED', 'RUNNING') THEN
    RAISE EXCEPTION 'agent_stage_runs % terminado es inmutable', OLD.id
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'agent_stage_runs_immutable';
  END IF;
  IF NEW.evaluation_run_id <> OLD.evaluation_run_id OR NEW.stage_code <> OLD.stage_code OR NEW.attempt_no <> OLD.attempt_no
     OR NEW.input_fingerprint <> OLD.input_fingerprint OR NEW.company_id <> OLD.company_id THEN
    RAISE EXCEPTION 'identidad de agent_stage_runs no modificable'
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'agent_stage_runs_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "agent_stage_runs_guard" BEFORE UPDATE OR DELETE ON "agent_stage_runs"
  FOR EACH ROW EXECUTE FUNCTION "agent_stage_runs_guard"();
