-- Stock ledger is append-only (plan §2.3): corrections are new movements.
CREATE TRIGGER stock_movements_no_update_delete
  BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
--> statement-breakpoint
CREATE TRIGGER stock_movements_no_truncate
  BEFORE TRUNCATE ON stock_movements
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();
--> statement-breakpoint
-- Global units with fixed factors (plan §4.1). Item packaging units live in item_units.
INSERT INTO units (code, name, dimension, factor_to_dimension_base) VALUES
  ('pcs', 'Pieces', 'count', 1),
  ('ml', 'Millilitre', 'volume', 1),
  ('L', 'Litre', 'volume', 1000),
  ('g', 'Gram', 'mass', 1),
  ('kg', 'Kilogram', 'mass', 1000)
ON CONFLICT (code) DO NOTHING;
