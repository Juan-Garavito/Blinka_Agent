-- companies.timezone debe ser una zona que PostgreSQL reconozca: de ella depende
-- el mes presupuestario local de las autorizaciones (ARCH-012). Un CHECK no puede
-- consultar el catálogo de zonas, por eso se valida con un trigger.
CREATE FUNCTION "companies_validate_timezone"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.timezone IS NULL OR btrim(NEW.timezone) = '' OR NEW.timezone <> btrim(NEW.timezone) THEN
    RAISE EXCEPTION 'zona horaria inválida' USING ERRCODE = 'check_violation', CONSTRAINT = 'companies_timezone_valid';
  END IF;
  PERFORM now() AT TIME ZONE NEW.timezone;
  RETURN NEW;
EXCEPTION
  WHEN invalid_parameter_value THEN
    RAISE EXCEPTION 'zona horaria inválida: %', NEW.timezone USING ERRCODE = 'check_violation', CONSTRAINT = 'companies_timezone_valid';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "companies_validate_timezone_trg"
BEFORE INSERT OR UPDATE OF "timezone" ON "companies"
FOR EACH ROW EXECUTE FUNCTION "companies_validate_timezone"();
