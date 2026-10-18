-- La capa de texto, sus páginas y las confirmaciones humanas son históricas e inmutables.
CREATE TRIGGER "document_text_layers_immutable" BEFORE UPDATE OR DELETE ON "document_text_layers"
  FOR EACH ROW EXECUTE FUNCTION "blinka_forbid_mutation"();
--> statement-breakpoint
CREATE TRIGGER "document_text_pages_immutable" BEFORE UPDATE OR DELETE ON "document_text_pages"
  FOR EACH ROW EXECUTE FUNCTION "blinka_forbid_mutation"();
--> statement-breakpoint
CREATE TRIGGER "invoice_field_confirmations_immutable" BEFORE UPDATE OR DELETE ON "invoice_field_confirmations"
  FOR EACH ROW EXECUTE FUNCTION "blinka_forbid_mutation"();
