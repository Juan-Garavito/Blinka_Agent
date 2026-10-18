CREATE TABLE "contract_hour_consumptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"invoice_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"hours" numeric(20, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hour_consumptions_invoice_key" UNIQUE("invoice_id"),
	CONSTRAINT "hour_consumptions_reservation_key" UNIQUE("reservation_id"),
	CONSTRAINT "hour_consumptions_hours_positive" CHECK ("contract_hour_consumptions"."hours" > 0),
	CONSTRAINT "hour_consumptions_period_format" CHECK ("contract_hour_consumptions"."period_key" ~ '^[0-9]{4}(-(0[1-9]|1[0-2])|-Q[1-4])?$')
);
--> statement-breakpoint
ALTER TABLE "contract_hour_consumptions" ADD CONSTRAINT "hour_consumptions_contract_fk" FOREIGN KEY ("company_id","contract_id") REFERENCES "public"."contracts"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_hour_consumptions" ADD CONSTRAINT "hour_consumptions_invoice_fk" FOREIGN KEY ("company_id","invoice_id") REFERENCES "public"."invoices"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_hour_consumptions" ADD CONSTRAINT "hour_consumptions_reservation_fk" FOREIGN KEY ("company_id","reservation_id") REFERENCES "public"."budget_reservations"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hour_consumptions_period_idx" ON "contract_hour_consumptions" USING btree ("company_id","contract_id","period_key");