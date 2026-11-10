-- One register per existing branch, a starting KHR rate (4,100 per USD, §12 default) and common discount reasons.
INSERT INTO "registers" ("branch_id", "name")
SELECT b.id, 'Register 1' FROM "branches" b
WHERE NOT EXISTS (SELECT 1 FROM "registers" r WHERE r.branch_id = b.id);
--> statement-breakpoint
INSERT INTO "exchange_rates" ("branch_id", "currency_code", "rate_to_base")
SELECT b.id, 'KHR', 4100 FROM "branches" b
WHERE NOT EXISTS (SELECT 1 FROM "exchange_rates" e WHERE e.branch_id = b.id AND e.currency_code = 'KHR');
--> statement-breakpoint
INSERT INTO "discount_reasons" ("org_id", "name")
SELECT o.id, r.name FROM "organizations" o CROSS JOIN (VALUES ('Staff'), ('Promotion'), ('Regular customer'), ('Complaint')) AS r(name)
ON CONFLICT DO NOTHING;
