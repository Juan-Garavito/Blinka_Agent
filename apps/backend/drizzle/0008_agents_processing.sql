CREATE TABLE "agent_stage_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"evaluation_run_id" uuid NOT NULL,
	"stage_code" text NOT NULL,
	"attempt_no" integer NOT NULL,
	"status" text NOT NULL,
	"input_fingerprint" char(64) NOT NULL,
	"reused_from_stage_run_id" uuid,
	"result_ref" text,
	"error_code" text,
	"error_retryable" boolean,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "agent_stage_runs_attempt_key" UNIQUE("evaluation_run_id","stage_code","attempt_no"),
	CONSTRAINT "agent_stage_runs_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "agent_stage_runs_stage_valid" CHECK ("agent_stage_runs"."stage_code" in ('EXTRACT_CLASSIFY', 'CONTRACT_MATCH', 'CONTRACT_VALIDATE', 'FINANCIAL_DECISION')),
	CONSTRAINT "agent_stage_runs_status_valid" CHECK ("agent_stage_runs"."status" in ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'REUSED')),
	CONSTRAINT "agent_stage_runs_attempt_positive" CHECK ("agent_stage_runs"."attempt_no" >= 1),
	CONSTRAINT "agent_stage_runs_fingerprint_hex" CHECK ("agent_stage_runs"."input_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "agent_stage_runs_reuse_consistent" CHECK (("agent_stage_runs"."status" = 'REUSED') = ("agent_stage_runs"."reused_from_stage_run_id" is not null)),
	CONSTRAINT "agent_stage_runs_failure_consistent" CHECK (("agent_stage_runs"."status" = 'FAILED') = ("agent_stage_runs"."error_code" is not null))
);
--> statement-breakpoint
CREATE TABLE "evaluation_contract_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"evaluation_run_id" uuid NOT NULL,
	"contract_version_id" uuid NOT NULL,
	"type_match" boolean NOT NULL,
	"reference_match" boolean,
	"selected" boolean NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "evaluation_candidates_run_version_key" UNIQUE("evaluation_run_id","contract_version_id"),
	CONSTRAINT "evaluation_candidates_company_id_key" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "evaluation_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"evaluation_run_id" uuid NOT NULL,
	"evaluation_check_id" uuid,
	"contract_candidate_id" uuid,
	"document_id" uuid,
	"source_field" text,
	"page_number" integer,
	"clause_ref" text,
	"excerpt" text,
	"verification_status" text NOT NULL,
	CONSTRAINT "evaluation_evidence_status_valid" CHECK ("evaluation_evidence"."verification_status" in ('MODEL_REPORTED', 'STRUCTURED_MATCH', 'USER_PROVIDED', 'REJECTED')),
	CONSTRAINT "evaluation_evidence_excerpt_length" CHECK ("evaluation_evidence"."excerpt" is null or length("evaluation_evidence"."excerpt") <= 500),
	CONSTRAINT "evaluation_evidence_page_positive" CHECK ("evaluation_evidence"."page_number" is null or "evaluation_evidence"."page_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "ai_usage_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"evaluation_run_id" uuid,
	"stage_run_id" uuid,
	"contract_version_id" uuid,
	"task_type" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"estimated_cost_usd" numeric(14, 8) NOT NULL,
	"status" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"is_simulated" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_logs_tokens_non_negative" CHECK ("ai_usage_logs"."input_tokens" >= 0 and "ai_usage_logs"."output_tokens" >= 0 and "ai_usage_logs"."estimated_cost_usd" >= 0 and "ai_usage_logs"."latency_ms" >= 0),
	CONSTRAINT "ai_usage_logs_status_valid" CHECK ("ai_usage_logs"."status" in ('SUCCEEDED', 'FAILED', 'TIMEOUT', 'REJECTED'))
);
--> statement-breakpoint
ALTER TABLE "agent_stage_runs" ADD CONSTRAINT "agent_stage_runs_run_fk" FOREIGN KEY ("company_id","evaluation_run_id") REFERENCES "public"."evaluation_runs"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_stage_runs" ADD CONSTRAINT "agent_stage_runs_reused_fk" FOREIGN KEY ("company_id","reused_from_stage_run_id") REFERENCES "public"."agent_stage_runs"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_contract_candidates" ADD CONSTRAINT "evaluation_candidates_run_fk" FOREIGN KEY ("company_id","evaluation_run_id") REFERENCES "public"."evaluation_runs"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_contract_candidates" ADD CONSTRAINT "evaluation_candidates_version_fk" FOREIGN KEY ("company_id","contract_version_id") REFERENCES "public"."contract_versions"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_evidence" ADD CONSTRAINT "evaluation_evidence_run_fk" FOREIGN KEY ("company_id","evaluation_run_id") REFERENCES "public"."evaluation_runs"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_evidence" ADD CONSTRAINT "evaluation_evidence_check_fk" FOREIGN KEY ("company_id","evaluation_check_id") REFERENCES "public"."evaluation_checks"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_evidence" ADD CONSTRAINT "evaluation_evidence_candidate_fk" FOREIGN KEY ("company_id","contract_candidate_id") REFERENCES "public"."evaluation_contract_candidates"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_evidence" ADD CONSTRAINT "evaluation_evidence_document_fk" FOREIGN KEY ("company_id","document_id") REFERENCES "public"."documents"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_company_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_run_fk" FOREIGN KEY ("company_id","evaluation_run_id") REFERENCES "public"."evaluation_runs"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_stage_fk" FOREIGN KEY ("company_id","stage_run_id") REFERENCES "public"."agent_stage_runs"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_contract_version_fk" FOREIGN KEY ("company_id","contract_version_id") REFERENCES "public"."contract_versions"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_stage_runs_fingerprint_idx" ON "agent_stage_runs" USING btree ("company_id","stage_code","input_fingerprint","status");--> statement-breakpoint
CREATE INDEX "evaluation_evidence_run_idx" ON "evaluation_evidence" USING btree ("company_id","evaluation_run_id");--> statement-breakpoint
CREATE INDEX "ai_usage_logs_company_time_idx" ON "ai_usage_logs" USING btree ("company_id","created_at");