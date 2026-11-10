-- "Charge to account" payment method (AR, plan §4.10) for existing organizations.
INSERT INTO "payment_methods" ("org_id", "name", "type")
SELECT o.id, 'Charge to account', 'account' FROM "organizations" o
ON CONFLICT DO NOTHING;
