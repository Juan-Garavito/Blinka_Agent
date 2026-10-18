CREATE TABLE "document_text_layers" (
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"status" text NOT NULL,
	"page_count" integer NOT NULL,
	"extractor" text NOT NULL,
	"text_sha256" char(64),
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_text_layers_pkey" PRIMARY KEY("document_id"),
	CONSTRAINT "document_text_layers_status_valid" CHECK ("document_text_layers"."status" in ('TEXT', 'NO_TEXT', 'UNPARSEABLE')),
	CONSTRAINT "document_text_layers_pages_valid" CHECK ("document_text_layers"."page_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "document_text_pages" (
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"page_no" integer NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "document_text_pages_pkey" PRIMARY KEY("document_id","page_no"),
	CONSTRAINT "document_text_pages_page_positive" CHECK ("document_text_pages"."page_no" >= 1)
);
--> statement-breakpoint
CREATE TABLE "invoice_field_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"invoice_version_id" uuid NOT NULL,
	"field" text NOT NULL,
	"confirmed_value" text NOT NULL,
	"confirmed_by_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_confirmations_version_field_key" UNIQUE("invoice_version_id","field"),
	CONSTRAINT "field_confirmations_field_format" CHECK ("invoice_field_confirmations"."field" ~ '^[a-zA-Z0-9_.\[\]]{2,60}$'),
	CONSTRAINT "field_confirmations_reason_not_blank" CHECK (btrim("invoice_field_confirmations"."reason") <> '')
);
--> statement-breakpoint
ALTER TABLE "evaluation_evidence" DROP CONSTRAINT "evaluation_evidence_status_valid";--> statement-breakpoint
ALTER TABLE "evaluation_evidence" ADD COLUMN "char_start" integer;--> statement-breakpoint
ALTER TABLE "evaluation_evidence" ADD COLUMN "char_end" integer;--> statement-breakpoint
ALTER TABLE "document_text_layers" ADD CONSTRAINT "document_text_layers_document_fk" FOREIGN KEY ("company_id","document_id") REFERENCES "public"."documents"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_text_pages" ADD CONSTRAINT "document_text_pages_document_fk" FOREIGN KEY ("company_id","document_id") REFERENCES "public"."documents"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_field_confirmations" ADD CONSTRAINT "invoice_field_confirmations_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_field_confirmations" ADD CONSTRAINT "field_confirmations_version_fk" FOREIGN KEY ("company_id","invoice_version_id") REFERENCES "public"."invoice_versions"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_evidence" ADD CONSTRAINT "evaluation_evidence_status_valid" CHECK ("evaluation_evidence"."verification_status" in ('MODEL_REPORTED', 'STRUCTURED_MATCH', 'USER_PROVIDED', 'REJECTED', 'TEXT_VERIFIED', 'NOT_FOUND', 'UNVERIFIABLE', 'HUMAN_CONFIRMED'));