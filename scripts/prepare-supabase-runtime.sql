-- PREPARADO, NO EJECUTADO. Solo después de autorizar proyecto/host/base exactos.
-- Drizzle y Graphile deben haberse migrado ANTES con MIGRATION_DATABASE_URL.
-- Ejecutar en una transacción con el rol de aprovisionamiento. No contiene secretos.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='blinka_runtime') THEN
    CREATE ROLE blinka_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END $$;
GRANT CONNECT ON DATABASE postgres TO blinka_runtime;
REVOKE ALL ON SCHEMA graphile_worker FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA graphile_worker FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA graphile_worker FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public, graphile_worker TO blinka_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA graphile_worker TO blinka_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, graphile_worker TO blinka_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA graphile_worker TO blinka_runtime;
-- Alcance solo tablas Blinka, nunca tablas de otras apps ni esquemas auth/storage.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['agent_stage_runs','ai_usage_logs','approval_matrix_rules','approval_personas','approval_requests','audit_events','auth_sessions','budget_reservation_allocations','budget_reservations','companies','company_policies','company_users','contract_hour_consumptions','contract_items','contract_versions','contracts','document_text_layers','document_text_pages','documents','evaluation_applied_policies','evaluation_checks','evaluation_contract_candidates','evaluation_evidence','evaluation_flows','evaluation_runs','expense_categories','fx_rate_snapshots','invoice_attachments','invoice_field_confirmations','invoice_lines','invoice_versions','invoices','monthly_budgets','policy_versions','rate_limit_buckets','users','vendor_bank_accounts','vendors'] LOOP
    IF to_regclass(format('public.%I',t)) IS NULL THEN
      RAISE EXCEPTION 'Falta tabla de negocio %; migrar antes',t;
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO blinka_runtime',t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    IF NOT EXISTS (SELECT FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='blinka_backend_only') THEN
      EXECUTE format('CREATE POLICY blinka_backend_only ON public.%I TO blinka_runtime USING (true) WITH CHECK (true)',t);
    END IF;
  END LOOP;
END $$;
-- El backend conserva el aislamiento por empresa en sus servicios. No existe
-- política de Data API para anon/authenticated. El rol privilegiado vive solo en servidor.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO blinka_runtime;
COMMIT;
-- Antes de usar el rol, el operador debe fijar LOGIN y contraseña por canal seguro
-- (por ejemplo, \password blinka_runtime en psql). Nunca guardar esa contraseña aquí.
-- Graphile 0.18 puede intentar migrar al arrancar si su revisión no es 20: el rol
-- runtime NO recibe CREATE/ownership. Actualizar primero con el rol de aprovisionamiento.
