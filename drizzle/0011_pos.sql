CREATE TABLE "dining_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"area" text,
	"seats" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discount_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"currency_code" text NOT NULL,
	"rate_to_base" numeric(18, 6) NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_rates_positive_ck" CHECK ("exchange_rates"."rate_to_base" > 0)
);
--> statement-breakpoint
CREATE TABLE "order_counters" (
	"branch_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"last_no" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "order_counters_branch_id_business_date_pk" PRIMARY KEY("branch_id","business_date")
);
--> statement-breakpoint
CREATE TABLE "order_line_modifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_line_id" uuid NOT NULL,
	"modifier_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"name_snapshot" text NOT NULL,
	"price_delta" numeric(18, 4) NOT NULL,
	"deduct_stock" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name_snapshot" text NOT NULL,
	"variant_name_snapshot" text NOT NULL,
	"qty" integer NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"modifiers_total" numeric(18, 4) DEFAULT '0' NOT NULL,
	"line_discount_type" text,
	"line_discount_value" numeric(18, 4),
	"line_discount_reason" text,
	"line_discount_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"discount_alloc" numeric(18, 4) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"line_total" numeric(18, 4) NOT NULL,
	"deduct_stock" boolean NOT NULL,
	"cost_total" numeric(18, 4),
	"cost_source" text,
	"note" text,
	"kitchen_station" text NOT NULL,
	"kitchen_status" text DEFAULT 'pending' NOT NULL,
	"sent_to_kitchen_at" timestamp with time zone,
	"kitchen_updated_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "order_lines_qty_ck" CHECK ("order_lines"."qty" > 0),
	CONSTRAINT "order_lines_kitchen_ck" CHECK ("order_lines"."kitchen_status" in ('pending', 'preparing', 'ready', 'served')),
	CONSTRAINT "order_lines_discount_type_ck" CHECK ("order_lines"."line_discount_type" is null or "order_lines"."line_discount_type" in ('percent', 'amount')),
	CONSTRAINT "order_lines_cost_source_ck" CHECK ("order_lines"."cost_source" is null or "order_lines"."cost_source" in ('actual', 'theoretical', 'none'))
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"order_no" text NOT NULL,
	"queue_no" integer NOT NULL,
	"business_date" date NOT NULL,
	"order_type" text DEFAULT 'takeaway' NOT NULL,
	"table_id" uuid,
	"customer_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"subtotal" numeric(18, 4) DEFAULT '0' NOT NULL,
	"discount_type" text,
	"discount_value" numeric(18, 4),
	"discount_reason" text,
	"discount_total" numeric(18, 4) DEFAULT '0' NOT NULL,
	"order_discount_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"tax_total" numeric(18, 4) DEFAULT '0' NOT NULL,
	"total" numeric(18, 4) DEFAULT '0' NOT NULL,
	"paid_total" numeric(18, 4) DEFAULT '0' NOT NULL,
	"refunded_total" numeric(18, 4) DEFAULT '0' NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax_inclusive" boolean DEFAULT true NOT NULL,
	"note" text,
	"held_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"voided_by" text,
	"approved_by" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_status_ck" CHECK ("orders"."status" in ('open', 'held', 'paid', 'voided', 'refunded', 'partially_refunded')),
	CONSTRAINT "orders_type_ck" CHECK ("orders"."order_type" in ('dine_in', 'takeaway')),
	CONSTRAINT "orders_discount_type_ck" CHECK ("orders"."discount_type" is null or "orders"."discount_type" in ('percent', 'amount'))
);
--> statement-breakpoint
CREATE TABLE "registers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_cash" (
	"shift_id" uuid NOT NULL,
	"currency_code" text NOT NULL,
	"opening_float" numeric(18, 4) DEFAULT '0' NOT NULL,
	"expected" numeric(18, 4),
	"counted" numeric(18, 4),
	"variance" numeric(18, 4),
	CONSTRAINT "shift_cash_shift_id_currency_code_pk" PRIMARY KEY("shift_id","currency_code"),
	CONSTRAINT "shift_cash_float_ck" CHECK ("shift_cash"."opening_float" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"register_id" uuid NOT NULL,
	"opened_by" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" text,
	"closed_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"notes" text,
	CONSTRAINT "shifts_status_ck" CHECK ("shifts"."status" in ('open', 'closed'))
);
--> statement-breakpoint
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_reasons" ADD CONSTRAINT "discount_reasons_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_counters" ADD CONSTRAINT "order_counters_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_modifiers" ADD CONSTRAINT "order_line_modifiers_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_modifiers" ADD CONSTRAINT "order_line_modifiers_modifier_id_modifiers_id_fk" FOREIGN KEY ("modifier_id") REFERENCES "public"."modifiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_modifiers" ADD CONSTRAINT "order_line_modifiers_group_id_modifier_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."modifier_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_table_id_dining_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."dining_tables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_voided_by_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registers" ADD CONSTRAINT "registers_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_cash" ADD CONSTRAINT "shift_cash_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_cash" ADD CONSTRAINT "shift_cash_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_register_id_registers_id_fk" FOREIGN KEY ("register_id") REFERENCES "public"."registers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_opened_by_user_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_closed_by_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dining_tables_branch_name_uq" ON "dining_tables" USING btree ("branch_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "discount_reasons_org_name_uq" ON "discount_reasons" USING btree ("org_id",lower("name"));--> statement-breakpoint
CREATE INDEX "exchange_rates_lookup_idx" ON "exchange_rates" USING btree ("branch_id","currency_code","effective_from");--> statement-breakpoint
CREATE INDEX "order_line_modifiers_line_idx" ON "order_line_modifiers" USING btree ("order_line_id");--> statement-breakpoint
CREATE INDEX "order_lines_order_idx" ON "order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_lines_kitchen_idx" ON "order_lines" USING btree ("kitchen_status","sent_to_kitchen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_branch_no_uq" ON "orders" USING btree ("branch_id","order_no");--> statement-breakpoint
CREATE INDEX "orders_branch_status_idx" ON "orders" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "orders_shift_idx" ON "orders" USING btree ("shift_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registers_branch_name_uq" ON "registers" USING btree ("branch_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_register_open_uq" ON "shifts" USING btree ("register_id") WHERE "shifts"."status" = 'open';--> statement-breakpoint
CREATE INDEX "shifts_branch_idx" ON "shifts" USING btree ("branch_id","opened_at");