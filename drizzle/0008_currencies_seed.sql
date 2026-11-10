-- Currencies (plan §4.4, §5.4). Exchange rates and settings arrive in Phase 6.
INSERT INTO currencies (code, name, symbol, decimals, cash_rounding) VALUES
  ('USD', 'US Dollar', '$', 2, 0.01),
  ('KHR', 'Cambodian Riel', '៛', 0, 100)
ON CONFLICT (code) DO NOTHING;
