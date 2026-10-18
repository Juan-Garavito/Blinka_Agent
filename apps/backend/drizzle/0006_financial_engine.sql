CREATE TABLE "invoice_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"milestone_ref" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_attachments_invoice_document_key" UNIQUE("invoice_id","document_id"),
	CONSTRAINT "invoice_attachments_purpose_valid" CHECK ("invoice_attachments"."purpose" in ('TIMESHEET', 'MILESTONE_ACCEPTANCE', 'DELIVERY_NOTE', 'OTHER'))
);
--> statement-breakpoint
CREATE TABLE "approval_matrix_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"policy_version_id" uuid NOT NULL,
	"min_amount_exclusive" numeric(20, 4) NOT NULL,
	"max_amount_inclusive" numeric(20, 4),
	"persona_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "approval_matrix_rules_range_valid" CHECK ("approval_matrix_rules"."min_amount_exclusive" >= 0 and coalesce("approval_matrix_rules"."max_amount_inclusive" > "approval_matrix_rules"."min_amount_exclusive", true))
);
--> statement-breakpoint
CREATE TABLE "company_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"scope_level" text NOT NULL,
	"category_id" uuid,
	"vendor_id" uuid,
	"contract_id" uuid,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_policies_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "company_policies_scope_valid" CHECK ("company_policies"."scope_level" in ('COMPANY', 'CATEGORY', 'VENDOR', 'CONTRACT')),
	CONSTRAINT "company_policies_scope_target" CHECK (case "company_policies"."scope_level"
        when 'COMPANY' then "company_policies"."category_id" is null and "company_policies"."vendor_id" is null and "company_policies"."contract_id" is null
        when 'CATEGORY' then "company_policies"."category_id" is not null and "company_policies"."vendor_id" is null and "company_policies"."contract_id" is null
        when 'VENDOR' then "company_policies"."vendor_id" is not null and "company_policies"."category_id" is null and "company_policies"."contract_id" is null
        when 'CONTRACT' then "company_policies"."contract_id" is not null and "company_policies"."category_id" is null and "company_policies"."vendor_id" is null
        else false end)
);
--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"auto_approval_limit_base" numeric(20, 4),
	"hard_invoice_cap_base" numeric(20, 4),
	"published_by_user_id" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_versions_policy_version_key" UNIQUE("policy_id","version_no"),
	CONSTRAINT "policy_versions_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "policy_versions_version_positive" CHECK ("policy_versions"."version_no" >= 1),
	CONSTRAINT "policy_versions_limits_valid" CHECK (coalesce("policy_versions"."auto_approval_limit_base" >= 0, true) and coalesce("policy_versions"."hard_invoice_cap_base" > 0, true)
        and coalesce("policy_versions"."auto_approval_limit_base" <= "policy_versions"."hard_invoice_cap_base", true))
);
--> statement-breakpoint
CREATE TABLE "fx_rate_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_currency" char(3) NOT NULL,
	"to_currency" char(3) NOT NULL,
	"rate" numeric(28, 12) NOT NULL,
	"provider" text NOT NULL,
	"provider_reference" text,
	"rate_date" date NOT NULL,
	"rate_timestamp" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"is_simulated" boolean NOT NULL,
	CONSTRAINT "fx_rate_snapshots_rate_positive" CHECK ("fx_rate_snapshots"."rate" > 0),
	CONSTRAINT "fx_rate_snapshots_currencies_iso" CHECK ("fx_rate_snapshots"."from_currency" ~ '^[A-Z]{3}$' and "fx_rate_snapshots"."to_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "fx_rate_snapshots_identity" CHECK ("fx_rate_snapshots"."from_currency" <> "fx_rate_snapshots"."to_currency" or ("fx_rate_snapshots"."rate" = 1 and "fx_rate_snapshots"."provider" = 'IDENTITY')),
	CONSTRAINT "fx_rate_snapshots_validity" CHECK ("fx_rate_snapshots"."valid_until" > "fx_rate_snapshots"."rate_timestamp")
);
--> statement-breakpoint
CREATE TABLE "evaluation_applied_policies" (
	"company_id" uuid NOT NULL,
	"evaluation_run_id" uuid NOT NULL,
	"policy_version_id" uuid NOT NULL,
	"applicability_reason" text NOT NULL,
	CONSTRAINT "evaluation_applied_policies_pkey" PRIMARY KEY("evaluation_run_id","policy_version_id")
);
--> statement-breakpoint
CREATE TABLE "evaluation_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"evaluation_run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"rule_code" text NOT NULL,
	"outcome" text NOT NULL,
	"effect" text NOT NULL,
	"observed_text" text,
	"expected_text" text,
	"observed_amount" numeric(20, 4),
	"expected_amount" numeric(20, 4),
	"currency" char(3),
	"reason" text NOT NULL,
	CONSTRAINT "evaluation_checks_run_seq_key" UNIQUE("evaluation_run_id","seq"),
	CONSTRAINT "evaluation_checks_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "evaluation_checks_outcome_valid" CHECK ("evaluation_checks"."outcome" in ('PASS', 'FAIL', 'UNKNOWN')),
	CONSTRAINT "evaluation_checks_effect_valid" CHECK ("evaluation_checks"."effect" in ('BLOCK', 'CORRECTION', 'APPROVAL', 'ENABLEMENT', 'ERROR', 'INFO')),
	CONSTRAINT "evaluation_checks_rule_format" CHECK ("evaluation_checks"."rule_code" ~ '^[A-Z][A-Z0-9_]{2,60}$')
);
--> statement-breakpoint
CREATE TABLE "evaluation_flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"previous_flow_id" uuid,
	"trigger_type" text NOT NULL,
	"justification" text,
	"opened_by_user_id" uuid,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"terminal_status" text,
	"closed_at" timestamp with time zone,
	CONSTRAINT "evaluation_flows_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "evaluation_flows_trigger_valid" CHECK ("evaluation_flows"."trigger_type" in ('MANUAL', 'UPLOAD', 'CORRECTION', 'APPROVAL_RESOLVED', 'RETRY', 'REEVALUATION')),
	CONSTRAINT "evaluation_flows_terminal_valid" CHECK ("evaluation_flows"."terminal_status" is null or "evaluation_flows"."terminal_status" in ('AUTORIZADA', 'BLOQUEADA', 'RECHAZADA')),
	CONSTRAINT "evaluation_flows_closed_consistent" CHECK (("evaluation_flows"."closed_at" is null) = ("evaluation_flows"."terminal_status" is null))
);
--> statement-breakpoint
CREATE TABLE "evaluation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"invoice_version_id" uuid NOT NULL,
	"run_no" integer NOT NULL,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"detected_billing_type" text,
	"selected_contract_version_id" uuid,
	"matched_bank_account_id" uuid,
	"fx_rate_snapshot_id" uuid,
	"amount_base" numeric(20, 4),
	"base_currency" char(3),
	"decision" text,
	"visible_outcome" text,
	"reason_code" text,
	"engine_version" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"evaluated_at" timestamp with time zone,
	CONSTRAINT "evaluation_runs_flow_run_key" UNIQUE("flow_id","run_no"),
	CONSTRAINT "evaluation_runs_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "evaluation_runs_status_valid" CHECK ("evaluation_runs"."status" in ('RUNNING', 'COMPLETED', 'SUPERSEDED')),
	CONSTRAINT "evaluation_runs_decision_valid" CHECK ("evaluation_runs"."decision" is null or "evaluation_runs"."decision" in ('AUTHORIZE', 'BLOCK', 'ESCALATE')),
	CONSTRAINT "evaluation_runs_outcome_valid" CHECK ("evaluation_runs"."visible_outcome" is null or "evaluation_runs"."visible_outcome" in ('AUTORIZADA', 'EN_APROBACION', 'EN_CORRECCION', 'BLOQUEADA', 'RECHAZADA', 'ERROR')),
	CONSTRAINT "evaluation_runs_decision_outcome_consistent" CHECK (case
        when "evaluation_runs"."status" <> 'COMPLETED' then "evaluation_runs"."decision" is null and "evaluation_runs"."visible_outcome" is null
        when "evaluation_runs"."visible_outcome" = 'AUTORIZADA' then "evaluation_runs"."decision" is not distinct from 'AUTHORIZE'
        when "evaluation_runs"."visible_outcome" = 'BLOQUEADA' then "evaluation_runs"."decision" is not distinct from 'BLOCK'
        when "evaluation_runs"."visible_outcome" in ('EN_APROBACION', 'EN_CORRECCION') then "evaluation_runs"."decision" is not distinct from 'ESCALATE'
        when "evaluation_runs"."visible_outcome" in ('ERROR', 'RECHAZADA') then "evaluation_runs"."decision" is null
        else false end),
	CONSTRAINT "evaluation_runs_completed_fields" CHECK ("evaluation_runs"."status" <> 'COMPLETED' or ("evaluation_runs"."visible_outcome" is not null and "evaluation_runs"."reason_code" is not null and "evaluation_runs"."evaluated_at" is not null)),
	CONSTRAINT "evaluation_runs_authorize_requires_contract" CHECK ("evaluation_runs"."decision" is distinct from 'AUTHORIZE' or ("evaluation_runs"."selected_contract_version_id" is not null and "evaluation_runs"."matched_bank_account_id" is not null and "evaluation_runs"."amount_base" is not null))
);
--> statement-breakpoint
CREATE TABLE "budget_reservation_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"monthly_budget_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"amount_base" numeric(20, 4) NOT NULL,
	CONSTRAINT "budget_allocations_reservation_scope_key" UNIQUE("reservation_id","scope"),
	CONSTRAINT "budget_allocations_scope_valid" CHECK ("budget_reservation_allocations"."scope" in ('GLOBAL', 'CATEGORY')),
	CONSTRAINT "budget_allocations_amount_positive" CHECK ("budget_reservation_allocations"."amount_base" > 0)
);
--> statement-breakpoint
CREATE TABLE "budget_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"authorizing_run_id" uuid NOT NULL,
	"fx_rate_snapshot_id" uuid,
	"original_amount" numeric(20, 4) NOT NULL,
	"original_currency" char(3) NOT NULL,
	"reserved_amount_base" numeric(20, 4) NOT NULL,
	"base_currency" char(3) NOT NULL,
	"period_yyyy_mm" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"authorized_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_reservations_invoice_key" UNIQUE("invoice_id"),
	CONSTRAINT "budget_reservations_run_key" UNIQUE("authorizing_run_id"),
	CONSTRAINT "budget_reservations_idempotency_key" UNIQUE("company_id","idempotency_key"),
	CONSTRAINT "budget_reservations_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "budget_reservations_amounts_positive" CHECK ("budget_reservations"."original_amount" > 0 and "budget_reservations"."reserved_amount_base" > 0),
	CONSTRAINT "budget_reservations_period_format" CHECK ("budget_reservations"."period_yyyy_mm" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "monthly_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"category_id" uuid,
	"period_yyyy_mm" text NOT NULL,
	"scope" text NOT NULL,
	"limit_base" numeric(20, 4) NOT NULL,
	"reserved_base" numeric(20, 4) DEFAULT '0' NOT NULL,
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_budgets_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "monthly_budgets_period_format" CHECK ("monthly_budgets"."period_yyyy_mm" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "monthly_budgets_scope_valid" CHECK (case "monthly_budgets"."scope" when 'GLOBAL' then "monthly_budgets"."category_id" is null when 'CATEGORY' then "monthly_budgets"."category_id" is not null else false end),
	CONSTRAINT "monthly_budgets_amounts_valid" CHECK ("monthly_budgets"."limit_base" >= 0 and "monthly_budgets"."reserved_base" >= 0 and "monthly_budgets"."reserved_base" <= "monthly_budgets"."limit_base")
);
--> statement-breakpoint
ALTER TABLE "invoice_attachments" ADD CONSTRAINT "invoice_attachments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_attachments" ADD CONSTRAINT "invoice_attachments_invoice_fk" FOREIGN KEY ("company_id","invoice_id") REFERENCES "public"."invoices"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_attachments" ADD CONSTRAINT "invoice_attachments_document_fk" FOREIGN KEY ("company_id","document_id") REFERENCES "public"."documents"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_matrix_rules" ADD CONSTRAINT "approval_matrix_rules_version_fk" FOREIGN KEY ("company_id","policy_version_id") REFERENCES "public"."policy_versions"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_matrix_rules" ADD CONSTRAINT "approval_matrix_rules_persona_fk" FOREIGN KEY ("company_id","persona_id") REFERENCES "public"."approval_personas"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_policies" ADD CONSTRAINT "company_policies_company_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_policies" ADD CONSTRAINT "company_policies_category_fk" FOREIGN KEY ("company_id","category_id") REFERENCES "public"."expense_categories"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_policies" ADD CONSTRAINT "company_policies_vendor_fk" FOREIGN KEY ("company_id","vendor_id") REFERENCES "public"."vendors"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_policies" ADD CONSTRAINT "company_policies_contract_fk" FOREIGN KEY ("company_id","contract_id") REFERENCES "public"."contracts"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_policy_fk" FOREIGN KEY ("company_id","policy_id") REFERENCES "public"."company_policies"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_applied_policies" ADD CONSTRAINT "evaluation_applied_policies_run_fk" FOREIGN KEY ("company_id","evaluation_run_id") REFERENCES "public"."evaluation_runs"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_applied_policies" ADD CONSTRAINT "evaluation_applied_policies_version_fk" FOREIGN KEY ("company_id","policy_version_id") REFERENCES "public"."policy_versions"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_checks" ADD CONSTRAINT "evaluation_checks_run_fk" FOREIGN KEY ("company_id","evaluation_run_id") REFERENCES "public"."evaluation_runs"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_flows" ADD CONSTRAINT "evaluation_flows_opened_by_user_id_users_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_flows" ADD CONSTRAINT "evaluation_flows_company_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_flows" ADD CONSTRAINT "evaluation_flows_invoice_fk" FOREIGN KEY ("company_id","invoice_id") REFERENCES "public"."invoices"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_flows" ADD CONSTRAINT "evaluation_flows_previous_fk" FOREIGN KEY ("company_id","previous_flow_id") REFERENCES "public"."evaluation_flows"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_fx_rate_snapshot_id_fx_rate_snapshots_id_fk" FOREIGN KEY ("fx_rate_snapshot_id") REFERENCES "public"."fx_rate_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_flow_fk" FOREIGN KEY ("company_id","flow_id") REFERENCES "public"."evaluation_flows"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_version_fk" FOREIGN KEY ("company_id","invoice_version_id") REFERENCES "public"."invoice_versions"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_contract_version_fk" FOREIGN KEY ("company_id","selected_contract_version_id") REFERENCES "public"."contract_versions"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_bank_account_fk" FOREIGN KEY ("company_id","matched_bank_account_id") REFERENCES "public"."vendor_bank_accounts"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservation_allocations" ADD CONSTRAINT "budget_allocations_reservation_fk" FOREIGN KEY ("company_id","reservation_id") REFERENCES "public"."budget_reservations"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservation_allocations" ADD CONSTRAINT "budget_allocations_budget_fk" FOREIGN KEY ("company_id","monthly_budget_id") REFERENCES "public"."monthly_budgets"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_fx_rate_snapshot_id_fx_rate_snapshots_id_fk" FOREIGN KEY ("fx_rate_snapshot_id") REFERENCES "public"."fx_rate_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_invoice_fk" FOREIGN KEY ("company_id","invoice_id") REFERENCES "public"."invoices"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_run_fk" FOREIGN KEY ("company_id","authorizing_run_id") REFERENCES "public"."evaluation_runs"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_budgets" ADD CONSTRAINT "monthly_budgets_company_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_budgets" ADD CONSTRAINT "monthly_budgets_category_fk" FOREIGN KEY ("company_id","category_id") REFERENCES "public"."expense_categories"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_policies_lookup_idx" ON "company_policies" USING btree ("company_id","active","scope_level");--> statement-breakpoint
CREATE INDEX "fx_rate_snapshots_pair_idx" ON "fx_rate_snapshots" USING btree ("from_currency","to_currency","provider","fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_flows_one_open_key" ON "evaluation_flows" USING btree ("invoice_id") WHERE "evaluation_flows"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "evaluation_flows_invoice_idx" ON "evaluation_flows" USING btree ("company_id","invoice_id","opened_at");--> statement-breakpoint
CREATE INDEX "evaluation_runs_flow_idx" ON "evaluation_runs" USING btree ("company_id","flow_id","run_no");--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_budgets_global_key" ON "monthly_budgets" USING btree ("company_id","period_yyyy_mm") WHERE "monthly_budgets"."scope" = 'GLOBAL';--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_budgets_category_key" ON "monthly_budgets" USING btree ("company_id","period_yyyy_mm","category_id") WHERE "monthly_budgets"."scope" = 'CATEGORY';