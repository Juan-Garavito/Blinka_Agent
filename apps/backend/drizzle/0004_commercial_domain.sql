CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_ref" text NOT NULL,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_ref" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"details" jsonb,
	CONSTRAINT "audit_events_actor_kind_valid" CHECK ("audit_events"."actor_kind" in ('USER', 'SYSTEM', 'AGENT')),
	CONSTRAINT "audit_events_event_type_format" CHECK ("audit_events"."event_type" ~ '^[a-z][a-z0-9_.]{2,80}$')
);
--> statement-breakpoint
CREATE TABLE "approval_personas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"designation" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_personas_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "approval_personas_name_not_blank" CHECK (btrim("approval_personas"."display_name") <> '' and btrim("approval_personas"."designation") <> '')
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_categories_company_code_key" UNIQUE("company_id","code"),
	CONSTRAINT "expense_categories_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "expense_categories_code_format" CHECK ("expense_categories"."code" ~ '^[A-Z0-9_-]{2,40}$'),
	CONSTRAINT "expense_categories_name_not_blank" CHECK (btrim("expense_categories"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "vendor_bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"country" char(2) NOT NULL,
	"currency" char(3) NOT NULL,
	"account_fingerprint" char(64) NOT NULL,
	"account_mask" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_bank_accounts_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "vendor_bank_accounts_vendor_fingerprint_key" UNIQUE("company_id","vendor_id","account_fingerprint"),
	CONSTRAINT "vendor_bank_accounts_status_valid" CHECK ("vendor_bank_accounts"."status" in ('PENDING', 'AUTHORIZED', 'BLOCKED')),
	CONSTRAINT "vendor_bank_accounts_country_iso" CHECK ("vendor_bank_accounts"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "vendor_bank_accounts_currency_iso" CHECK ("vendor_bank_accounts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "vendor_bank_accounts_fingerprint_hex" CHECK ("vendor_bank_accounts"."account_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "vendor_bank_accounts_mask_format" CHECK ("vendor_bank_accounts"."account_mask" ~ '^\*{4}[A-Z0-9]{2,4}$')
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"legal_name" text NOT NULL,
	"tax_reference" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendors_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "vendors_status_valid" CHECK ("vendors"."status" in ('PENDING', 'AUTHORIZED', 'BLOCKED')),
	CONSTRAINT "vendors_legal_name_not_blank" CHECK (btrim("vendors"."legal_name") <> ''),
	CONSTRAINT "vendors_tax_reference_normalized" CHECK ("vendors"."tax_reference" is null or "vendors"."tax_reference" ~ '^[A-Z0-9]{3,40}$')
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" char(64) NOT NULL,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "documents_kind_valid" CHECK ("documents"."kind" in ('INVOICE', 'CONTRACT', 'EVIDENCE')),
	CONSTRAINT "documents_mime_valid" CHECK ("documents"."mime_type" in ('application/pdf', 'image/png', 'image/jpeg')),
	CONSTRAINT "documents_size_positive" CHECK ("documents"."size_bytes" > 0),
	CONSTRAINT "documents_sha256_hex" CHECK ("documents"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "documents_storage_key_format" CHECK ("documents"."storage_key" ~ '^companies/[0-9a-f-]{36}/documents/[0-9a-f-]{36}$'),
	CONSTRAINT "documents_original_name_safe" CHECK ("documents"."original_name" ~ '^[^/\\]{1,120}$')
);
--> statement-breakpoint
CREATE TABLE "contract_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_version_id" uuid NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"item_kind" text NOT NULL,
	"unit" text,
	"agreed_quantity" numeric(20, 4),
	"unit_price" numeric(20, 6),
	"milestone_ref" text,
	"agreed_amount" numeric(20, 4),
	CONSTRAINT "contract_items_version_code_key" UNIQUE("contract_version_id","code"),
	CONSTRAINT "contract_items_kind_valid" CHECK ("contract_items"."item_kind" in ('FIXED_FEE', 'HOURLY_RATE', 'MILESTONE', 'PO_LINE')),
	CONSTRAINT "contract_items_code_format" CHECK ("contract_items"."code" ~ '^[A-Za-z0-9._-]{1,40}$'),
	CONSTRAINT "contract_items_fields_by_kind" CHECK (case "contract_items"."item_kind"
        when 'HOURLY_RATE' then "contract_items"."unit" is not null and "contract_items"."unit_price" is not null
        when 'MILESTONE' then "contract_items"."milestone_ref" is not null and "contract_items"."agreed_amount" is not null
        when 'PO_LINE' then "contract_items"."agreed_quantity" is not null and "contract_items"."unit_price" is not null
        when 'FIXED_FEE' then "contract_items"."agreed_amount" is not null
        else false end),
	CONSTRAINT "contract_items_amounts_positive" CHECK (coalesce("contract_items"."unit_price" > 0, true) and coalesce("contract_items"."agreed_quantity" > 0, true) and coalesce("contract_items"."agreed_amount" > 0, true))
);
--> statement-breakpoint
CREATE TABLE "contract_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"billing_frequency" text,
	"fixed_period_amount" numeric(20, 4),
	"quantity_cap_per_period" numeric(20, 4),
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"origin" text NOT NULL,
	"source_document_id" uuid,
	"confirmed_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_versions_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "contract_versions_contract_version_key" UNIQUE("contract_id","version_no"),
	CONSTRAINT "contract_versions_version_positive" CHECK ("contract_versions"."version_no" >= 1),
	CONSTRAINT "contract_versions_currency_iso" CHECK ("contract_versions"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "contract_versions_period_valid" CHECK ("contract_versions"."effective_to" is null or "contract_versions"."effective_to" >= "contract_versions"."effective_from"),
	CONSTRAINT "contract_versions_status_valid" CHECK ("contract_versions"."status" in ('DRAFT', 'CONFIRMED', 'REJECTED')),
	CONSTRAINT "contract_versions_origin_valid" CHECK ("contract_versions"."origin" in ('MANUAL', 'AI_SUGGESTED')),
	CONSTRAINT "contract_versions_frequency_valid" CHECK ("contract_versions"."billing_frequency" is null or "contract_versions"."billing_frequency" in ('MONTHLY', 'QUARTERLY', 'ANNUAL')),
	CONSTRAINT "contract_versions_amounts_positive" CHECK (coalesce("contract_versions"."fixed_period_amount" > 0, true) and coalesce("contract_versions"."quantity_cap_per_period" > 0, true)),
	CONSTRAINT "contract_versions_confirmation_consistent" CHECK (("contract_versions"."status" = 'CONFIRMED') = ("contract_versions"."confirmed_by_user_id" is not null and "contract_versions"."confirmed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"contract_ref" text NOT NULL,
	"billing_type" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "contracts_vendor_ref_key" UNIQUE("company_id","vendor_id","contract_ref"),
	CONSTRAINT "contracts_billing_type_valid" CHECK ("contracts"."billing_type" in ('RECURRING', 'HOURLY', 'MILESTONE', 'PURCHASE_ORDER')),
	CONSTRAINT "contracts_status_valid" CHECK ("contracts"."status" in ('ACTIVE', 'TERMINATED')),
	CONSTRAINT "contracts_ref_not_blank" CHECK (btrim("contracts"."contract_ref") <> '')
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_version_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"concept" text NOT NULL,
	"item_ref" text,
	"quantity" numeric(20, 4),
	"unit" text,
	"unit_price" numeric(20, 6),
	"subtotal" numeric(20, 4) NOT NULL,
	"tax_amount" numeric(20, 4),
	CONSTRAINT "invoice_lines_version_line_key" UNIQUE("invoice_version_id","line_no"),
	CONSTRAINT "invoice_lines_line_positive" CHECK ("invoice_lines"."line_no" >= 1),
	CONSTRAINT "invoice_lines_concept_not_blank" CHECK (btrim("invoice_lines"."concept") <> ''),
	CONSTRAINT "invoice_lines_amounts_valid" CHECK ("invoice_lines"."subtotal" >= 0 and coalesce("invoice_lines"."quantity" > 0, true) and coalesce("invoice_lines"."unit_price" >= 0, true) and coalesce("invoice_lines"."tax_amount" >= 0, true))
);
--> statement-breakpoint
CREATE TABLE "invoice_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"origin" text NOT NULL,
	"source_document_id" uuid NOT NULL,
	"supplier_invoice_number" text,
	"issuer_tax_reference" text,
	"issue_date" date,
	"due_date" date,
	"service_period_start" date,
	"service_period_end" date,
	"original_currency" char(3),
	"subtotal" numeric(20, 4),
	"taxes" numeric(20, 4),
	"discounts" numeric(20, 4),
	"total_amount" numeric(20, 4),
	"contract_ref_cited" text,
	"payment_destination_raw" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_versions_invoice_version_key" UNIQUE("invoice_id","version_no"),
	CONSTRAINT "invoice_versions_id_invoice_key" UNIQUE("id","invoice_id"),
	CONSTRAINT "invoice_versions_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "invoice_versions_version_positive" CHECK ("invoice_versions"."version_no" >= 1),
	CONSTRAINT "invoice_versions_origin_valid" CHECK ("invoice_versions"."origin" in ('UPLOAD', 'EXTRACTION', 'MANUAL_CORRECTION')),
	CONSTRAINT "invoice_versions_currency_iso" CHECK ("invoice_versions"."original_currency" is null or "invoice_versions"."original_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "invoice_versions_period_valid" CHECK (coalesce("invoice_versions"."service_period_end" >= "invoice_versions"."service_period_start", true)),
	CONSTRAINT "invoice_versions_amounts_non_negative" CHECK (coalesce("invoice_versions"."subtotal" >= 0, true) and coalesce("invoice_versions"."taxes" >= 0, true) and coalesce("invoice_versions"."discounts" >= 0, true) and coalesce("invoice_versions"."total_amount" >= 0, true))
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"category_id" uuid,
	"invoice_number_normalized" text,
	"current_version_id" uuid,
	"replaces_invoice_id" uuid,
	"duplicate_of_invoice_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "invoices_number_normalized_format" CHECK ("invoices"."invoice_number_normalized" is null or "invoices"."invoice_number_normalized" ~ '^[A-Z0-9]{1,60}$'),
	CONSTRAINT "invoices_not_self_referencing" CHECK (coalesce("invoices"."replaces_invoice_id" <> "invoices"."id", true) and coalesce("invoices"."duplicate_of_invoice_id" <> "invoices"."id", true)),
	CONSTRAINT "invoices_duplicate_has_no_identity" CHECK ("invoices"."duplicate_of_invoice_id" is null or "invoices"."invoice_number_normalized" is null)
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_company_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_personas" ADD CONSTRAINT "approval_personas_company_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_company_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_bank_accounts" ADD CONSTRAINT "vendor_bank_accounts_vendor_fk" FOREIGN KEY ("company_id","vendor_id") REFERENCES "public"."vendors"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_company_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_items" ADD CONSTRAINT "contract_items_contract_version_id_contract_versions_id_fk" FOREIGN KEY ("contract_version_id") REFERENCES "public"."contract_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_contract_fk" FOREIGN KEY ("company_id","contract_id") REFERENCES "public"."contracts"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_document_fk" FOREIGN KEY ("company_id","source_document_id") REFERENCES "public"."documents"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_vendor_fk" FOREIGN KEY ("company_id","vendor_id") REFERENCES "public"."vendors"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_category_fk" FOREIGN KEY ("company_id","category_id") REFERENCES "public"."expense_categories"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_version_id_invoice_versions_id_fk" FOREIGN KEY ("invoice_version_id") REFERENCES "public"."invoice_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_versions" ADD CONSTRAINT "invoice_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_versions" ADD CONSTRAINT "invoice_versions_invoice_fk" FOREIGN KEY ("company_id","invoice_id") REFERENCES "public"."invoices"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_versions" ADD CONSTRAINT "invoice_versions_document_fk" FOREIGN KEY ("company_id","source_document_id") REFERENCES "public"."documents"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_vendor_fk" FOREIGN KEY ("company_id","vendor_id") REFERENCES "public"."vendors"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_category_fk" FOREIGN KEY ("company_id","category_id") REFERENCES "public"."expense_categories"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_replaces_fk" FOREIGN KEY ("company_id","replaces_invoice_id") REFERENCES "public"."invoices"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_duplicate_of_fk" FOREIGN KEY ("company_id","duplicate_of_invoice_id") REFERENCES "public"."invoices"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("company_id","entity_type","entity_ref","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_company_time_idx" ON "audit_events" USING btree ("company_id","occurred_at");--> statement-breakpoint
CREATE INDEX "vendor_bank_accounts_fingerprint_idx" ON "vendor_bank_accounts" USING btree ("company_id","account_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_company_tax_reference_key" ON "vendors" USING btree ("company_id","tax_reference") WHERE "vendors"."tax_reference" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_storage_key_key" ON "documents" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "documents_company_sha256_idx" ON "documents" USING btree ("company_id","sha256");--> statement-breakpoint
CREATE INDEX "contract_versions_lookup_idx" ON "contract_versions" USING btree ("company_id","contract_id","status","effective_from");--> statement-breakpoint
CREATE INDEX "invoice_versions_document_idx" ON "invoice_versions" USING btree ("company_id","source_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_identity_key" ON "invoices" USING btree ("company_id","vendor_id","invoice_number_normalized") WHERE "invoices"."invoice_number_normalized" is not null;--> statement-breakpoint
CREATE INDEX "invoices_company_created_idx" ON "invoices" USING btree ("company_id","created_at");