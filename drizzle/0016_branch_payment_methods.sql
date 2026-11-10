-- Payment methods become per branch (owner's answer, 2026-11-10). Each existing
-- org-wide method is copied to every branch of its org, every reference is
-- pointed at its own branch's copy, then the org-wide originals are removed.
DROP INDEX "payment_methods_org_name_uq";--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
CREATE TEMP TABLE pm_map ON COMMIT DROP AS
  SELECT pm.id AS old_id, b.id AS branch_id, gen_random_uuid() AS new_id
  FROM "payment_methods" pm JOIN "branches" b ON b.org_id = pm.org_id;--> statement-breakpoint
INSERT INTO "payment_methods" ("id", "org_id", "branch_id", "name", "type", "is_active", "created_at")
  SELECT m.new_id, pm.org_id, m.branch_id, pm.name, pm.type, pm.is_active, pm.created_at
  FROM pm_map m JOIN "payment_methods" pm ON pm.id = m.old_id;--> statement-breakpoint
UPDATE "payments" t SET method_id = m.new_id FROM pm_map m WHERE t.method_id = m.old_id AND t.branch_id = m.branch_id;--> statement-breakpoint
UPDATE "customer_payments" t SET method_id = m.new_id FROM pm_map m WHERE t.method_id = m.old_id AND t.branch_id = m.branch_id;--> statement-breakpoint
UPDATE "supplier_payments" t SET method_id = m.new_id FROM pm_map m WHERE t.method_id = m.old_id AND t.branch_id = m.branch_id;--> statement-breakpoint
UPDATE "supplier_returns" t SET refund_method_id = m.new_id FROM pm_map m WHERE t.refund_method_id = m.old_id AND t.branch_id = m.branch_id;--> statement-breakpoint
DELETE FROM "payment_methods" WHERE "branch_id" IS NULL;--> statement-breakpoint
ALTER TABLE "payment_methods" ALTER COLUMN "branch_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_branch_name_uq" ON "payment_methods" USING btree ("branch_id",lower("name"));
