-- El consumo de horas es histórico (append-only), como la reserva que lo origina.
CREATE TRIGGER "contract_hour_consumptions_immutable" BEFORE UPDATE OR DELETE ON "contract_hour_consumptions"
  FOR EACH ROW EXECUTE FUNCTION "blinka_forbid_mutation"();
