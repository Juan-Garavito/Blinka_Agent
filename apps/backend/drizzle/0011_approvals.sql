CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"requested_by_run_id" uuid NOT NULL,
	"invoice_version_id" uuid NOT NULL,
	"persona_id" uuid NOT NULL,
	"amount_base" numeric(20, 4) NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" uuid,
	"resolution_reason" text,
	CONSTRAINT "approval_requests_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "approval_requests_status_valid" CHECK ("approval_requests"."status" in ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED')),
	CONSTRAINT "approval_requests_amount_positive" CHECK ("approval_requests"."amount_base" > 0),
	CONSTRAINT "approval_requests_resolution_consistent" CHECK (case "approval_requests"."status"
        when 'PENDING' then "approval_requests"."resolved_at" is null and "approval_requests"."resolved_by_user_id" is null
        when 'SUPERSEDED' then "approval_requests"."resolved_at" is not null and "approval_requests"."resolved_by_user_id" is null
        else "approval_requests"."resolved_at" is not null and "approval_requests"."resolved_by_user_id" is not null and coalesce(btrim("approval_requests"."resolution_reason") <> '', false) end)
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_flow_fk" FOREIGN KEY ("company_id","flow_id") REFERENCES "public"."evaluation_flows"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_run_fk" FOREIGN KEY ("company_id","requested_by_run_id") REFERENCES "public"."evaluation_runs"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_version_fk" FOREIGN KEY ("company_id","invoice_version_id") REFERENCES "public"."invoice_versions"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_persona_fk" FOREIGN KEY ("company_id","persona_id") REFERENCES "public"."approval_personas"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_one_pending_key" ON "approval_requests" USING btree ("flow_id") WHERE "approval_requests"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "approval_requests_company_status_idx" ON "approval_requests" USING btree ("company_id","status","requested_at");