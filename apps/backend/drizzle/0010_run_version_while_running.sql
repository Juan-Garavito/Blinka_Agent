-- Mientras una corrida está RUNNING, la etapa de extracción puede apuntarla a la
-- nueva invoice_version (origin EXTRACTION) de la MISMA factura. Finalizada, sigue inmutable.
CREATE OR REPLACE FUNCTION "evaluation_runs_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status <> 'RUNNING' THEN
    RAISE EXCEPTION 'evaluation_runs % ya finalizada es inmutable', OLD.id
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'evaluation_runs_immutable';
  END IF;
  IF NEW.flow_id <> OLD.flow_id OR NEW.run_no <> OLD.run_no OR NEW.company_id <> OLD.company_id THEN
    RAISE EXCEPTION 'identidad de evaluation_runs no modificable'
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'evaluation_runs_immutable';
  END IF;
  IF NEW.invoice_version_id <> OLD.invoice_version_id AND NOT EXISTS (
       SELECT 1 FROM invoice_versions a JOIN invoice_versions b ON a.invoice_id = b.invoice_id
        WHERE a.id = OLD.invoice_version_id AND b.id = NEW.invoice_version_id) THEN
    RAISE EXCEPTION 'la corrida solo puede apuntar a otra versión de la misma factura'
      USING ERRCODE = 'restrict_violation', CONSTRAINT = 'evaluation_runs_immutable';
  END IF;
  RETURN NEW;
END;
$$;
