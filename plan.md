# Café POS — Build Plan

> This file is the build spec for Claude Code. Work through the phases **in order**.
> Finish one phase, including its tests and acceptance checks, before starting the next.
> Tick the checkboxes (`- [x]`) as tasks are completed, so this file always shows progress.

---

## 0. Project summary

A web-based POS for cafés with real inventory control:

- **Inventory** with multiple units of measure, an immutable stock ledger, weighted average cost (WAC), adjustments and low-stock alerts.
- **Menu** with variants, modifiers and **recipes** that deduct ingredients automatically on each sale, with an option to turn deduction off per product, variant or modifier.
- **POS**: dine-in/takeaway, held bills, discounts, split payments, multi-currency (USD + KHR), voids/refunds approved with a manager PIN, and shift open/close.
- **Supplier credit (AP)**: goods receipt → supplier invoice → partial payments → AP aging.
- **Reports**: sales, profit/COGS, stock, AR/AP, plus multi-branch, roles/permissions and an audit log.

### Environments
| Environment | Where | Cost |
|---|---|---|
| Development | Developer laptop: Next.js dev server + PostgreSQL in Docker (`docker compose`) | $0 |
| Production | One VPS (4 GB RAM, 2 vCPU, Ubuntu LTS) running **Coolify**, which hosts the Next.js app (Docker) + PostgreSQL; daily backups to S3-compatible storage (Cloudflare R2 / Backblaze B2) | ~$5–8/month |

There is **no Supabase, Vercel or other managed backend**. Everything is plain Next.js + PostgreSQL, so it runs the same on the laptop and on the VPS.

---

## 1. Tech stack (do not change without asking)

| Layer | Choice |
|---|---|
| Framework | **Next.js 16** (App Router, `output: "standalone"`) + **TypeScript** (strict) |
| UI | **Tailwind CSS** + **shadcn/ui**, icons from `lucide-react` |
| Tables | **TanStack Table** (shadcn data-table pattern) |
| Data fetching on client | **TanStack Query** (polling via `refetchInterval` where live data is needed) |
| Charts | **Recharts** (shadcn chart components) |
| Forms | **React Hook Form + Zod** |
| Client state | **Zustand** (POS cart / current order only) |
| Database | **PostgreSQL 17** (Docker locally, Coolify one-click in production) |
| ORM / migrations | **Drizzle ORM** + **drizzle-kit** (SQL migrations committed in `drizzle/`) |
| DB driver | `postgres` (postgres.js) |
| Auth | **Better Auth** (email + password, DB sessions, Drizzle adapter) |
| Password / PIN hashing | Better Auth built-in for passwords; `@node-rs/argon2` for manager PINs |
| File uploads (product images) | S3-compatible bucket (Cloudflare R2) via `@aws-sdk/client-s3` presigned URLs; local dev uses MinIO in docker compose **or** a local `uploads/` folder behind the same interface |
| Live updates | **Polling** (kitchen screen every 3 s, low-stock badge every 30 s). No WebSocket server in v1 |
| Tests | **Vitest** (unit + integration against a disposable test database), **Playwright** for E2E later |
| Package manager | pnpm |
| Deployment | Dockerfile (multi-stage, standalone output) → Coolify app from the GitHub repo |

---

## 2. Non-negotiable engineering rules

1. **Stock and money change only through the service layer** (`lib/services/*`). Each service function:
   - runs inside **one `db.transaction()`**
   - checks the user's permission first (`requirePermission(ctx, branchId, 'perm.key')`)
   - locks the affected `stock_levels` / document rows with `SELECT ... FOR UPDATE` (Drizzle `.for('update')`)
   - writes the ledger and the **audit log** in the same transaction.
   UI components and route handlers never write stock, totals or balances directly.
2. **Server Actions are thin.** They validate input with Zod, build the request context (user, branch) and call one service function. No business logic in actions or components.
3. **The stock ledger is append-only.** `stock_movements` rows are never updated or deleted. Corrections are new movements (adjustment, or a reversal). Add a DB trigger that raises an error on UPDATE/DELETE of `stock_movements` and `audit_log`.
4. **Quantities are always stored in the item's base unit.** Conversion happens at input and display time. Keep the entered unit and quantity on the row for traceability.
5. **Use `numeric`, never `float`/`real`.** Quantities `numeric(18,4)`, cost per base unit `numeric(18,6)`, money `numeric(18,4)`. In TypeScript use **`decimal.js`** for all arithmetic (Drizzle returns numerics as strings, so never convert them to `number` for maths).
6. **Every table has** `id uuid pk default gen_random_uuid()`, `created_at timestamptz default now()`, and where relevant `branch_id`, `created_by` (user id), `updated_at`.
7. **Branch scoping is enforced in the service and query layer.** Every read query for branch data filters by branches the user belongs to (`ctx.branchIds`). Write a helper `branchScope(ctx)` and use it everywhere. There is no RLS (the app connects with a single DB user), so this rule is critical. Cover it with tests.
8. **Snapshot prices and costs at the time of sale.** Order lines store `unit_price`, `modifier_price` and `cost` as they were when sold.
9. **Soft-delete master data** (`is_active = false`). Never hard-delete products, items, suppliers or users that have history.
10. **Sensitive actions need a reason and are audited**: void, refund, discount above the limit, stock adjustment, price change, cost override, shift variance.
11. **The server recalculates every total.** Never trust totals, prices or costs sent from the client.
12. Server Components fetch data. Client Components only where interactivity is needed. Pure domain maths lives in `lib/domain/*` and is unit-tested.
13. Secrets only in environment variables. Commit `.env.example`, never `.env`.

---

## 3. Folder structure

```
cafe-pos/
├── app/
│   ├── (auth)/login/page.tsx
│   ├── (app)/layout.tsx                 # sidebar, branch switcher
│   ├── (app)/dashboard/page.tsx
│   ├── (app)/pos/page.tsx               # cashier screen (touch-first)
│   ├── (app)/pos/held/page.tsx
│   ├── (app)/kitchen/page.tsx           # polling order queue
│   ├── (app)/orders/[id]/page.tsx       # order detail, refund/void
│   ├── (app)/shifts/page.tsx
│   ├── (app)/inventory/{items,movements,adjustments,counts,transfers}/...
│   ├── (app)/menu/{products,modifiers}/...
│   ├── (app)/purchasing/{suppliers,receipts,payments}/...
│   ├── (app)/customers/...              # AR (house accounts)
│   ├── (app)/reports/[report]/page.tsx
│   ├── (app)/settings/{branches,users,roles,currencies,taxes,units}/...
│   ├── (app)/audit/page.tsx
│   ├── receipt/[orderId]/page.tsx       # 80mm print layout
│   └── api/
│       ├── auth/[...all]/route.ts       # Better Auth handler
│       ├── health/route.ts              # for Coolify health check
│       └── kitchen/route.ts             # JSON feed for polling
├── components/{ui,pos,inventory,menu,purchasing,reports,shared}/
├── db/
│   ├── schema/*.ts                      # Drizzle schema, one file per module
│   ├── index.ts                         # db client
│   └── seed.ts
├── drizzle/                             # generated SQL migrations (committed)
├── lib/
│   ├── auth.ts / auth-client.ts         # Better Auth config
│   ├── context.ts                       # getContext(): user, current branch, branchIds, permissions
│   ├── permissions.ts                   # requirePermission, hasPermission, branchScope
│   ├── services/                        # ALL writes to stock/money live here
│   │   ├── stock.ts                     # applyStockMovement (WAC + lock)
│   │   ├── orders.ts                    # saveOrder, holdOrder, payOrder, voidOrder, refundOrder
│   │   ├── shifts.ts
│   │   ├── purchasing.ts                # postGoodsReceipt, recordSupplierPayment, supplierReturn
│   │   ├── inventory.ts                 # adjustments, counts, transfers
│   │   ├── customers.ts                 # AR payments
│   │   ├── audit.ts
│   │   └── pin.ts                       # verifyManagerPin
│   ├── queries/                         # read-only queries & reports
│   ├── domain/{units,money,currency,wac,aging,recipe}.ts
│   ├── storage.ts                       # S3/R2 upload helper
│   └── validators/*.ts                  # zod schemas
├── stores/pos-cart.ts
├── tests/{unit,integration,e2e}/
├── docker-compose.yml                   # local Postgres (+ optional MinIO)
├── Dockerfile                           # production image
├── drizzle.config.ts
└── .env.example
```

---

## 4. Domain rules and worked examples (use as test cases)

### 4.1 Units of measure
- Every inventory item has **one base unit** (e.g. `ml`, `g`, `pcs`).
- Each item can have extra **item units**, each with a `factor_to_base`.
  - Item "Fresh Milk": base `ml`. Units: `bottle = 1000`, `case = 12000`.
  - Receiving `2 case` → `24,000 ml` stored.
  - Display: 30,500 ml → "2 case 6 bottle 500 ml" (greedy breakdown) or "30.5 L".
- Global units (ml/L, g/kg) have fixed factors. Item-specific packaging units live per item.
- Purchases, adjustments and counts can be entered in any unit of the item. Recipes are entered in the base unit or a compatible global unit.

### 4.2 Weighted average cost (per item, per branch)
On every **inbound with cost** (purchase receipt, positive opening balance, transfer in):
```
if on_hand <= 0:  new_avg = unit_cost_in
else:             new_avg = (on_hand * avg + qty_in * unit_cost_in) / (on_hand + qty_in)
```
- **Outbound** (sale, waste, negative adjustment, transfer out) is valued at the **current avg**. The movement stores `unit_cost` and `total_cost`. This is the COGS.
- **Transfer in** brings the sending branch's avg as `unit_cost_in`.
- **Refund with restock** returns stock at the cost recorded on the original sale movement.
- Positive adjustments without a cost use the current avg (no change to avg).
- Negative stock is **allowed** for sales (cafés can't block a sale) but flagged in reports. Setting `block_negative_stock` (default false).

Test example:
| Step | Movement | Qty (ml) | Unit cost | On hand | Avg cost/ml |
|---|---|---|---|---|---|
| 1 | Purchase 1 case @ $18.00 | +12,000 | 0.0015 | 12,000 | 0.001500 |
| 2 | Sale (latte uses 200 ml) | −200 | 0.0015 | 11,800 | 0.001500 |
| 3 | Purchase 1 case @ $21.00 | +12,000 | 0.00175 | 23,800 | 0.001626 |
| 4 | Waste adjustment | −800 | 0.001626 | 23,000 | 0.001626 |

Step 3 check: (11,800 × 0.0015 + 12,000 × 0.00175) / 23,800 = (17.70 + 21.00) / 23,800 = 0.0016260504.

### 4.3 Recipes and auto-deduction
- A **variant** (e.g. Latte – Large) has recipe lines: `item_id`, `qty_base`.
- A **modifier** can also have recipe lines (e.g. "Extra shot" = 18 g coffee beans; "Oat milk" = +200 ml oat milk **and** a negative line −200 ml fresh milk to replace it).
- Resale items (bottled water) use a recipe with 1 line: 1 pcs of that item.
- On sale (when the order is **paid**), deduct `(variant recipe + Σ modifier recipes) × line qty` for every line. Write one `stock_movement` per item per order line, with `ref_type = 'order_line'`.
- Products with no recipe are sold without deduction and listed in the "Products without recipe" report.
- Recipe changes only affect future sales.

#### Option to not deduct stock
- **Product level:** `products.deduct_stock` (boolean, default `true`). When `false`, selling any variant of the product writes **no** stock movements, even if a recipe exists. The recipe is kept, so theoretical cost and margin still show.
- **Variant level override:** `product_variants.deduct_stock` (nullable boolean). `null` = follow the product; `true`/`false` = override for that variant only. Example: "Hot Water" variant doesn't deduct, while other variants of the same product do.
- **Modifier level:** `modifiers.deduct_stock` (boolean, default `true`). When `false`, the modifier's recipe lines are ignored on sale.
- **Effective rule** for an order line: `variant.deduct_stock ?? product.deduct_stock`. If `false`, skip the variant recipe **and** all modifier recipes for that line. If `true`, deduct the variant recipe plus the recipes of modifiers whose `deduct_stock = true`.
- The setting is **snapshotted** on the order line (`order_lines.deduct_stock`), so later changes don't affect past orders or refunds. A refund with restock on a line that didn't deduct does nothing to stock.
- **COGS for non-deducted lines:** `cost_total` is filled with the **theoretical cost** (recipe qty × current avg) and flagged `cost_source = 'theoretical'` (vs `'actual'` for deducted lines), so profit reports stay meaningful. Lines without a recipe get `cost_total = 0`, `cost_source = 'none'`.
- Changing `deduct_stock` needs `menu.manage` and is audited.
- UI: a "Deduct stock on sale" switch on the product form, a three-state selector (Follow product / Yes / No) per variant, and a switch per modifier. The product list shows a "No stock deduction" badge.
- Reports: the Profit/COGS report shows `cost_source` totals, and "Theoretical vs actual usage" excludes non-deducted lines.
- **Theoretical cost** of each variant = Σ (recipe qty × current avg). Show it on the menu screen next to the price, with the margin %.

### 4.4 Multi-currency (USD base, KHR secondary)
- The organization has a **base currency** (USD). Other accepted currencies (KHR) have a branch-level **exchange rate** with `effective_from`. Keep rate history.
- All order totals are calculated in base currency. The POS also shows the total in KHR = `total_usd × rate`, **rounded to the nearest 100 riel** (rounding configurable per currency).
- A payment row stores: `currency`, `amount_tendered` (in that currency), `rate_used`, `amount_base`, `change_currency`, `change_amount`, `change_base`, `rounding_base`.
- Example: total $4.75, rate 4,100. Customer pays $5 cash → change $0.25 = 1,025 riel → round to **1,000 riel**. Record the rounding difference (≈ $0.006) in `rounding_base`.
- Split payment example: $10.00 total → $5 cash USD + 20,500 KHR cash (= $5.00) → paid.

### 4.5 Discounts
- Line-level or order-level, as a percent or a fixed amount, with an optional reason.
- Permission `pos.discount.apply` with a limit (`max %`). Above the limit, a **manager PIN** is required (`pos.discount.override`).
- Order-level discounts are split proportionally across lines for profit reporting (`order_lines.discount_alloc`).

### 4.6 Taxes (configurable, default off)
- Branch setting: tax rate (e.g. VAT 10%), and whether prices are tax-inclusive or tax-exclusive. Store `tax_amount` on lines and the order.

### 4.7 Order lifecycle
```
open ──(hold)──► held ──(resume)──► open
open ──(pay fully)──► paid ──(refund full/partial)──► refunded / partially_refunded
open/held ──(void, manager PIN)──► voided
```
- **Void** = cancel before payment. No stock effect (stock is deducted only on pay), but audited.
- **Refund** = after payment. Select lines and quantities, refund payment method and currency, **restock** yes/no per line (default no for prepared drinks, yes for resale items). Requires a manager PIN plus a reason. Creates a `refunds` row, refund payments, and reverse stock movements when restocking.
- Every order belongs to an **open shift**. You can't sell without an open shift.
- Order number per branch per day, sequential (e.g. `B1-20261108-0042`) using a counter table locked `FOR UPDATE`. Also print a short queue number.

### 4.8 Shifts
- Open: cashier, branch, register, opening float **per currency**.
- During the shift: cash pay-in/pay-out with a reason.
- Close: counted cash per currency → expected = float + cash sales − cash refunds ± cash movements → variance. Variance above the threshold needs a manager PIN. Print X-report (while open) and Z-report (at close).

### 4.9 Supplier credit (Accounts Payable)
- **Goods receipt** (= supplier invoice): supplier, branch, invoice no., date, payment terms (days) → `due_date`, lines (item, unit, qty, unit cost), optional extra costs (delivery) **allocated to lines by value** before WAC is calculated.
- `postGoodsReceipt`: writes purchase movements, updates WAC, sets `amount_due = total`, status `unpaid`. Drafts can be edited; posted receipts can't (use a **supplier return**, which writes negative movements at the receipt cost and creates a credit).
- **Supplier payment**: amount, method, currency, date → **allocated** to one or more open receipts (oldest first by default, editable). Partial payments supported. Receipt status `unpaid` / `partial` / `paid`.
- Unallocated payment = supplier credit balance, which can be allocated later.
- **AP aging** by `due_date` as of a chosen date: Current, 1–30, 31–60, 61–90, 90+ days overdue, per supplier, with totals.

#### Direct import (pay now, no supplier credit)
For goods bought and paid on the spot (e.g. market run for milk or ice), skip the credit/AP flow:
- A goods receipt has `purchase_type`: **`credit`** (the flow above) or **`direct`**.
- **Direct** receipts:
  - Supplier is **optional** (pick one, or type a free-text name such as "Central Market").
  - No payment terms or due date. On posting, the full amount is paid immediately: choose payment method and currency (USD/KHR, converted at the branch rate).
  - Posting (`postGoodsReceipt`) does everything in one transaction: stock movements + WAC (same as credit), plus a `supplier_payments` row fully allocated to the receipt. Status becomes `posted` with `payment_status = 'paid'` and `amount_due = 0`.
  - **Paid from the cash drawer** (optional checkbox): requires an open shift and also writes a `cash_movements` pay-out on that shift (reason "Direct purchase #…"), so expected cash at shift close is correct.
  - Direct receipts **never appear in AP aging** or the open-invoice lists. They do appear in the supplier statement (if a supplier was chosen) and in a new **Direct purchases** report.
- Extra costs, unit conversion, landed cost and supplier returns work the same as for credit receipts. A return on a direct receipt records a refund instead of a supplier credit.
- **Quick entry screen** (`/purchasing/receipts/new?type=direct`): short form (date, optional supplier, lines, total, payment method, "paid from drawer"), with a single **Post & Pay** button. Also reachable from the POS menu so a cashier can record a quick purchase during a shift (needs `purchasing.direct`).

### 4.10 Customer credit (Accounts Receivable, small scope)
- Customers (name, phone, credit limit). Payment method **"Charge to account"** at the POS (needs permission, blocked over the credit limit).
- Customer payments allocated to charged orders → AR aging (same buckets as AP).

### 4.11 Multi-branch
- One organization, many branches. Stock, shifts, orders, exchange rates and price overrides are **per branch**.
- Menu is shared, with optional **per-branch price override** and availability.
- **Stock transfer**: draft → sent (transfer_out at sender avg) → received (transfer_in; a different received qty is recorded as transfer loss).
- Users can belong to several branches with a different role in each. There's a branch switcher (stored in a cookie, validated on every request). Owner/admin can report on "All branches".

### 4.12 Low-stock alerts
- `stock_levels.reorder_level` (base unit, entered in any item unit) per item per branch.
- Dashboard widget, `/inventory/items?filter=low` list and a sidebar badge (polled every 30 s).
- "Suggested reorder" report: items below reorder level with last supplier and last cost.

### 4.13 Stock count (stock take)
- Create a count for a branch (all items or a category) → snapshot system qty → enter counted qty (any unit) → post → `count_adjustment` movements for the differences at current avg. Needs `inventory.count`.

---

## 5. Data model (PostgreSQL via Drizzle)

> Columns listed are the important ones. Add `id`, `created_at`, `updated_at`, `created_by` as per §2.6.

### 5.1 Auth, organization and access
- Better Auth tables: `user`, `session`, `account`, `verification` (generated by Better Auth CLI for the Drizzle adapter)
- `profiles` (user_id pk → user.id, full_name, pin_hash, is_active)
- `organizations` (name, base_currency_code, settings jsonb)
- `branches` (org_id, code, name, address, phone, receipt_header, receipt_footer, tax_rate, tax_inclusive, settings jsonb, is_active)
- `roles` (org_id, name, is_system) — seed: Owner, Admin, Manager, Cashier, Barista/Kitchen, Stock Keeper, Accountant
- `permissions` (key pk, description) — see §5.10
- `role_permissions` (role_id, permission_key, limit_value numeric null)
- `user_branch_roles` (user_id, branch_id, role_id)
- No public sign-up: users are created by an admin (Better Auth `disableSignUp`, admin creates accounts).

### 5.2 Units and inventory
- `units` (code, name, dimension `count|volume|mass`, factor_to_dimension_base) — global: pcs, ml, L(1000), g, kg(1000)
- `item_categories` (name)
- `items` (sku, name, category_id, base_unit_id, item_type `ingredient|resale|packaging|other`, default_supplier_id, is_active)
- `item_units` (item_id, name, factor_to_base, is_purchase_default, is_count_default)
- `stock_levels` (branch_id, item_id, qty_on_hand, avg_cost, reorder_level, last_cost) — **unique (branch_id, item_id)**, changed **only** by `applyStockMovement`
- `stock_movements` (branch_id, item_id, movement_type, qty_base signed, unit_cost, total_cost, qty_after, avg_cost_after, entered_unit_label, entered_qty, ref_type, ref_id, reason, created_by, created_at)
  - movement_type: `opening|purchase|purchase_return|sale|refund_restock|adjustment_in|adjustment_out|waste|count_adjustment|transfer_out|transfer_in`
  - index (branch_id, item_id, created_at)
- `stock_adjustments` (branch_id, reason_code `waste|damage|expired|staff_meal|correction|other`, note, status draft/posted) + `stock_adjustment_lines`
- `stock_counts` + `stock_count_lines` (item_id, system_qty, counted_qty_base, diff)
- `stock_transfers` (from_branch_id, to_branch_id, status draft/sent/received/cancelled) + `stock_transfer_lines` (item_id, qty_sent, qty_received, unit_cost)

### 5.3 Menu
- `menu_categories` (name, sort_order, color, is_active)
- `products` (category_id, name, description, image_key, kitchen_station `bar|kitchen|none`, deduct_stock bool default true, sort_order, is_active)
- `product_variants` (product_id, name, price, sku, deduct_stock bool null, sort_order, is_default)
- `branch_variant_prices` (branch_id, variant_id, price, is_available)
- `modifier_groups` (name, min_select, max_select, is_required)
- `modifiers` (group_id, name, price_delta, deduct_stock bool default true, sort_order, is_active)
- `product_modifier_groups` (product_id, group_id, sort_order)
- `recipe_lines` (variant_id null, modifier_id null, item_id, qty_base) — CHECK exactly one of variant_id / modifier_id

### 5.4 POS
- `registers` (branch_id, name)
- `shifts` (branch_id, register_id, opened_by, opened_at, closed_by, closed_at, status, notes)
- `shift_cash` (shift_id, currency_code, opening_float, expected, counted, variance)
- `cash_movements` (shift_id, type pay_in/pay_out, currency_code, amount, reason)
- `dining_tables` (branch_id, name, area, seats, is_active)
- `order_counters` (branch_id, business_date, last_no) — for order numbers
- `orders` (branch_id, shift_id, order_no, queue_no, order_type, table_id, customer_id, status, subtotal, discount_total, tax_total, total, paid_total, refunded_total, note, held_at, paid_at, voided_at, void_reason, voided_by, approved_by)
- `order_lines` (order_id, variant_id, product_name_snapshot, variant_name_snapshot, qty, unit_price, modifiers_total, line_discount_type, line_discount_value, discount_alloc, tax_amount, line_total, deduct_stock, cost_total, cost_source `actual|theoretical|none`, note, kitchen_station, kitchen_status `pending|preparing|ready|served`, kitchen_updated_at)
- `order_line_modifiers` (order_line_id, modifier_id, name_snapshot, price_delta)
- `currencies` (code pk, name, symbol, decimals, cash_rounding) — KHR 100, USD 0.01
- `exchange_rates` (branch_id, currency_code, rate_to_base, effective_from)
- `payment_methods` (org_id, name, type `cash|khqr|card|bank_transfer|account|other`, is_active)
- `payments` (order_id, shift_id, method_id, currency_code, amount_tendered, rate_used, amount_base, change_currency, change_amount, change_base, rounding_base, reference, is_refund)
- `refunds` (order_id, shift_id, reason, approved_by, total_base) + `refund_lines` (order_line_id, qty, amount, restock)
- `discount_reasons` (name)

### 5.5 Purchasing and AP
- `suppliers` (name, contact, phone, email, address, payment_terms_days, is_active)
- `goods_receipts` (branch_id, purchase_type `credit|direct`, supplier_id null, supplier_name_text null, supplier_invoice_no, receipt_date, due_date null, paid_from_shift_id null, status draft/posted/cancelled, subtotal, extra_costs, total, amount_paid, amount_due, payment_status unpaid/partial/paid, note)
- `goods_receipt_lines` (receipt_id, item_id, item_unit_id, qty_entered, qty_base, unit_cost_entered, line_total, allocated_extra, landed_unit_cost_base)
- `supplier_returns` + `supplier_return_lines`
- `supplier_payments` (supplier_id, branch_id, payment_date, method_id, currency_code, amount, rate_used, amount_base, reference, unallocated_base)
- `supplier_payment_allocations` (payment_id, receipt_id, amount_base)

### 5.6 Customers and AR
- `customers` (name, phone, credit_limit, is_active)
- `customer_payments` (customer_id, branch_id, payment_date, method_id, amount_base, reference) + `customer_payment_allocations` (payment_id, order_id, amount_base)

### 5.7 Audit
- `audit_log` (org_id, branch_id, user_id, action, entity, entity_id, before jsonb, after jsonb, reason, approved_by, ip, created_at)
- Written by `lib/services/audit.ts` inside the same transaction as the change.
- Master-data updates (products, variants, prices, items, suppliers, roles, user roles, exchange rates, branches) go through small service functions that record before/after.
- DB trigger blocks UPDATE/DELETE on `audit_log` and `stock_movements`.

### 5.8 Key service functions (all in one transaction, permission-checked)
| Function | Purpose |
|---|---|
| `verifyManagerPin(ctx, branchId, pin, permission)` → approverId | Checks the PIN hash and that the approver has the permission at the branch. Rate-limit 5 failed tries / 5 min |
| `openShift`, `closeShift`, `addCashMovement` | Shift lifecycle |
| `saveOrder(ctx, input)` | Create/update an open order, recalculate all totals server-side |
| `holdOrder`, `resumeOrder` | |
| `payOrder(ctx, orderId, payments)` | Validate paid ≥ total, insert payments, mark paid, **deduct recipes**, write movements with COGS, fill `cost_total` |
| `voidOrder(ctx, orderId, reason, approverId)` | |
| `refundOrder(ctx, orderId, lines, payments, reason, approverId)` | Partial/full, restock option |
| `postGoodsReceipt(ctx, receiptId)` | Movements + WAC + AP |
| `recordSupplierPayment(ctx, input)` | With allocations |
| `postStockAdjustment`, `postStockCount` | |
| `sendTransfer`, `receiveTransfer` | |
| `applyStockMovement(tx, input)` | **Internal helper used by all of the above**: `SELECT ... FOR UPDATE` on `stock_levels` (insert the row if missing), applies WAC, inserts the movement, returns the new qty/avg |
| `recordCustomerPayment(ctx, input)` | AR |

### 5.9 Access control (no RLS)
- `getContext()` (server-only): reads the Better Auth session → user → active branch (cookie) → `branchIds` the user belongs to → permission set for the active branch. Cached per request.
- `requirePermission(ctx, branchId, key)` throws `ForbiddenError`. `hasPermission` returns a boolean for UI.
- `branchScope(ctx)` returns the Drizzle `where` fragment limiting rows to `ctx.branchIds` (or the active branch).
- Middleware redirects unauthenticated users to `/login`. The sidebar hides links the user has no permission for, but the **server always re-checks**.

### 5.10 Permission keys (seed)
```
pos.sell, pos.hold, pos.discount.apply, pos.discount.override, pos.void, pos.refund,
pos.price_override, pos.charge_account, shift.open, shift.close, shift.cash_movement,
shift.close_variance_override, inventory.view, inventory.manage_items, inventory.adjust,
inventory.count, inventory.transfer, inventory.view_cost, menu.view, menu.manage,
purchasing.view, purchasing.receive, purchasing.direct, purchasing.pay, customers.manage, ar.receive_payment,
reports.sales, reports.profit, reports.inventory, reports.ap, reports.ar, reports.all_branches,
settings.manage, users.manage, roles.manage, audit.view
```
Default role mapping goes in `db/seed.ts` (Cashier: pos.sell, pos.hold, pos.discount.apply ≤10%, shift.open/close …; Manager: + void/refund/overrides/adjust/reports; and so on).

---

## 6. Screens (UI requirements)

### POS screen (`/pos`), tablet landscape first, 1024×768 minimum
- Left: category tabs → product grid (big touch tiles with image/colour + price).
- Tap product → if it has variants or modifiers → dialog (variant chips, modifier groups enforcing min/max, qty, note).
- Right: cart (lines, modifiers, line discount, qty +/−, remove), order type toggle, table picker, customer picker, order discount, totals in **USD and KHR**.
- Buttons: **Hold**, **Held bills** (badge count), **Send to kitchen**, **Pay**.
- Pay dialog: method buttons, currency toggle, quick-cash buttons ($1/$5/$10/$20, 5,000/10,000/20,000/50,000៛), multiple payments, remaining and change in both currencies, change-currency choice.
- After payment: print receipt (opens `/receipt/[id]` and the print dialog), start a new order.
- Keyboard shortcuts on desktop (F2 search, F8 pay, F9 hold).
- Reusable **Manager PIN dialog** component.

### Kitchen screen (`/kitchen`)
- Polls `/api/kitchen?branch=…&station=…&since=…` every **3 seconds** (TanStack Query `refetchInterval`), returning open order lines not yet served.
- Cards per order with lines, modifiers and notes; filter by station (bar/kitchen); tap to move pending → preparing → ready → served. Elapsed-time colour (green < 5 min, amber < 10, red ≥ 10). Play a short sound when a new order arrives.

### Receipt (`/receipt/[orderId]`)
- 80mm CSS (`@page { size: 80mm auto; margin: 0 }`): branch header, order no, queue no, lines, modifiers, discounts, tax, totals in USD + KHR, payments, change, cashier, date/time, footer. Reprints are marked "REPRINT", refund receipts marked as such.

### Back office
- Data tables with search, filters and CSV export on every list page.
- Item form: base unit + item units table + reorder levels per branch + current stock and avg cost per branch (cost only with `inventory.view_cost`).
- Product form: variants, modifier groups, **recipe editor** per variant (item search, qty, unit) with live theoretical cost and margin %.
- Goods receipt form: supplier, invoice no, date, terms → due date, lines, extra costs, totals → Save draft / Post.
- Supplier page: open invoices, payments, balance, aging.

---

## 7. Reports (`/reports/...`)

All reports have: branch filter (or "All" with permission), date range, CSV export, print view. Implement them as read-only queries in `lib/queries/reports/*.ts` (Drizzle `sql` template or SQL views created in migrations for the heavy ones).

| Report | Contents |
|---|---|
| Sales summary | Gross sales, discounts, refunds, net sales, tax, order count, average ticket; by day/hour |
| Sales by product / category / variant / modifier | Qty, net sales, % of total |
| Sales by payment method & currency | Including KHR vs USD cash collected |
| Sales by staff / shift | Including voids and refunds per staff member |
| **Profit / COGS** | Net sales − COGS (sale movements minus restocked refunds) = gross profit, margin %; by product and category |
| Stock on hand / valuation | Qty (chosen display unit) × avg cost, per branch |
| Stock movement history | Filter by item/type/date, running balance |
| Low stock / suggested reorder | |
| Waste & adjustments | By reason, value |
| Theoretical vs actual usage | Recipe-based expected usage vs count differences per item for a period |
| AP aging | Buckets per §4.9, drill-down to invoices |
| Supplier statement | Invoices, payments, running balance |
| Direct purchases | Direct (pay-now) receipts by date, supplier/name, payment method, paid from drawer |
| AR aging & customer statement | |
| Shift report (X/Z) | |
| Void & refund log | With approver and reason |
| Audit log viewer | Filter by user/action/entity/date |

---

## 8. Local development setup

`docker-compose.yml`:
- `postgres:17` on port 5432, named volume, `POSTGRES_DB=cafe_pos`, plus a second database `cafe_pos_test` for integration tests (init script).
- Optional `minio` for S3-compatible image uploads (or use the local-folder storage driver).

`.env.example`:
```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/cafe_pos
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/cafe_pos_test
BETTER_AUTH_SECRET=change-me
BETTER_AUTH_URL=http://localhost:3000
STORAGE_DRIVER=local            # local | s3
S3_ENDPOINT=
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_PUBLIC_URL=
```

`package.json` scripts:
```
dev, build, start, lint, typecheck,
db:up        -> docker compose up -d
db:generate  -> drizzle-kit generate
db:migrate   -> drizzle-kit migrate (or a small migrate script using drizzle-orm/migrator)
db:seed      -> tsx db/seed.ts
db:reset     -> drop + migrate + seed (local only, refuses if NODE_ENV=production)
test         -> vitest run (unit)
test:int     -> vitest run tests/integration (uses TEST_DATABASE_URL, migrates fresh)
test:e2e     -> playwright test
```

---

## 9. Production deployment (VPS + Coolify)

### 9.1 Server
- VPS: **2 vCPU, 4 GB RAM**, Ubuntu LTS, region closest to Cambodia (Singapore).
- Install Coolify with the official one-line script. Enable the firewall (allow 22, 80, 443; Coolify dashboard 8000 only from the admin IP, or behind its own domain with HTTPS).
- SSH key login only, password login disabled. Enable unattended security updates.

### 9.2 Database
- Coolify → add **PostgreSQL 17** (standalone) resource. Not publicly exposed; the app connects over the internal Docker network.
- **Backups:** daily schedule (e.g. `0 2 * * *`, 2 AM Cambodia time → set server TZ or adjust cron), upload to an **S3-compatible bucket (Cloudflare R2 or Backblaze B2)**, keep 14 daily + local 3.
- Test a restore into a temporary database once after setup and then monthly. Document the steps in `docs/restore.md`.

### 9.3 App
- `Dockerfile`: multi-stage (deps → build → runner) using Next.js `output: "standalone"`, non-root user, `HEALTHCHECK` hitting `/api/health`.
- Coolify → new application from the GitHub repo, build pack **Dockerfile**, auto-deploy on push to `main`.
- Environment variables set in Coolify (same names as `.env.example`, production values; `BETTER_AUTH_URL=https://pos.<domain>`).
- **Migrations run on deploy**: `instrumentation.ts` runs the drizzle migrator when the server starts (`MIGRATE_ON_START=1`, set in the Dockerfile), before it accepts requests. Migrations must be backward-compatible (add columns first, remove later).
- Domain: `pos.<domain>` pointed to the VPS, HTTPS via Coolify (Let's Encrypt).
- Product images: R2 bucket (`STORAGE_DRIVER=s3`).

### 9.4 Operations checklist (put in `docs/operations.md`)
- How to deploy, roll back (redeploy the previous commit in Coolify), restore a backup, add a branch, reset a user's password/PIN.
- Monitoring: Coolify notifications (email/Telegram) for failed deploys and failed backups; an uptime check on `/api/health`.

---

## 10. Build phases

### Phase 0 — Setup
- [x] `create-next-app` (TS, Tailwind, App Router, ESLint), pnpm, `@/` imports, `output: "standalone"`
- [x] shadcn/ui init + base components (button, input, dialog, sheet, table, tabs, form, select, badge, sonner, dropdown-menu, command, card)
- [x] `docker-compose.yml` (Postgres + test DB), `.env.example`, Drizzle config + db client
- [x] TanStack Query provider, `decimal.js` money helpers stub
- [x] Vitest config; integration test harness that migrates `TEST_DATABASE_URL` fresh and wraps each test in a transaction rolled back afterwards
- [x] `/api/health` route
- [x] README with setup steps
- [x] **Accept:** `pnpm db:up && pnpm db:migrate && pnpm dev` works on a clean machine; `pnpm test` passes

### Phase 1 — Foundation: auth, branches, roles, audit
- [x] Better Auth (email + password, sign-up disabled), Drizzle adapter, login page, logout, middleware redirect
- [x] Schema §5.1, §5.7; audit/ledger protection triggers; permissions + roles seed; first Owner user created by `db:seed` from env vars
- [x] `getContext`, `requirePermission`, `hasPermission`, `branchScope` + tests
- [x] `(app)` layout with sidebar filtered by permission, branch switcher (cookie, validated)
- [x] Settings: branches CRUD, users (create, assign branch + role, set PIN, deactivate), roles & permissions matrix editor
- [x] `verifyManagerPin` with rate limiting + `ManagerPinDialog` component
- [x] Audit service + audit log viewer
- [x] **Accept:** a cashier can't open settings (UI hidden **and** server action rejects); a manager PIN approves; changing a role is audited; a user can't read another branch's data

### Phase 2 — Inventory core
- [x] Schema §5.2, unit seed (pcs, ml, L, g, kg)
- [x] `lib/domain/units.ts` (convert, breakdown display) + unit tests
- [x] `applyStockMovement` with WAC and row locking + integration tests reproducing table §4.2 exactly
- [x] Concurrency test: 20 parallel sales on the same item give the correct final qty
- [x] Item categories, items CRUD with item units, reorder levels per branch, opening stock (`opening` movement with cost)
- [x] Stock adjustments (draft → post) with reason codes
- [x] Stock counts (snapshot → enter → post)
- [x] Movement history page with running balance
- [x] Low-stock list, dashboard widget, sidebar badge (polling)
- [x] **Accept:** WAC example passes; concurrency test passes; updating or deleting a `stock_movements` row fails

### Phase 3 — Purchasing and AP
- [x] Schema §5.5
- [x] Suppliers CRUD
- [x] Goods receipt form (any item unit, extra cost allocated by value) → `postGoodsReceipt`
- [x] **Direct import** (§4.9): `purchase_type = direct`, optional supplier / free-text name, Post & Pay in one transaction, quick entry screen
- [x] Supplier returns
- [x] Supplier payments with allocation UI (auto oldest-first, editable), partial payments, unallocated credit
- [x] Supplier statement + AP aging (`lib/domain/aging.ts` unit-tested)
- [x] **Accept:** receipt with 2 cases @ $18 + $2 delivery gives the correct landed cost and WAC; a $50 invoice paid $20 then $30 goes partial → paid; aging buckets correct for a given as-of date; a direct receipt updates stock and WAC, is marked paid immediately, and never shows in AP aging

### Phase 4 — Menu and recipes
- [x] Schema §5.3
- [x] Menu categories, products, variants, branch price overrides/availability
- [x] Modifier groups and modifiers, attach to products, min/max rules
- [x] Recipe editor (variant + modifier recipes, negative lines for substitutions), theoretical cost and margin
- [x] "Deduct stock on sale" settings: product switch, variant override (Follow / Yes / No), modifier switch, list badge (§4.3)
- [x] Image upload (`lib/storage.ts`, local + S3 drivers)
- [x] **Accept:** Latte Large + Oat milk + Extra shot shows the correct theoretical cost; changing `deduct_stock` is audited

### Phase 5 — POS core
- [x] Schema §5.4 (orders, lines, tables, registers, shifts, counters)
- [x] Shift open/close UI (float per currency); POS blocked without an open shift
- [x] POS screen layout, product grid, variant/modifier dialog, cart store (Zustand)
- [x] `saveOrder` (server recalculates totals), dine-in/takeaway, table picker, order numbers
- [x] Hold / resume / held-bills list
- [x] Line and order discounts with permission limits + manager override
- [x] Taxes per branch setting
- [x] Send to kitchen + kitchen screen (3 s polling, station filter, status buttons, sound)
- [x] **Accept:** server totals match client totals for 20 random carts (property test); held bills survive a page reload; a new order shows on the kitchen screen within ~3 s

### Phase 6 — Payments, multi-currency, refunds, shifts
- [x] Currencies, exchange rates (history), payment methods settings
- [x] `lib/domain/money.ts` + `currency.ts` (conversion, cash rounding) + unit tests for the §4.4 examples
- [x] Pay dialog: split payments, multi-currency, quick cash, change in a chosen currency
- [x] `payOrder` with recipe deduction and COGS; receipt print page
- [x] Void (manager PIN) and refund (partial/full, restock per line, refund method/currency)
- [x] Cash pay-in/out, close shift with expected vs counted per currency, variance approval, X/Z report print
- [x] Direct purchase "paid from drawer" option (needs an open shift, writes a cash pay-out) + entry point from the POS menu
- [x] Charge to customer account (AR) + customers CRUD + customer payments
- [x] **Accept:** §4.4 examples pass; paying a latte deducts milk and beans with the correct COGS; a product with `deduct_stock = false` writes no movements and records theoretical cost; a variant override works both ways (product off / variant on, product on / variant off); a modifier with `deduct_stock = false` is skipped; a partial refund with restock returns stock at the original cost; expected shift cash is correct after sales, refunds and pay-outs

### Phase 7 — Reports and dashboard
- [x] Report queries + pages for every report in §7
- [x] Dashboard: today's sales, orders, average ticket, top products, low stock, 7/30-day sales chart, open shifts
- [x] CSV export + print styles
- [x] **Accept:** profit report (net sales − COGS) reconciles with the movement ledger for a seeded week of data

### Phase 8 — Multi-branch completion
- [x] Stock transfers (send/receive, differences)
- [x] All-branches report mode, branch comparison chart
- [x] Per-branch receipt settings, tax, exchange rates
- [x] **Accept:** transfer value is conserved (sender value out = receiver value in + loss)

### Phase 9 — Hardening and deployment
- [x] Seed script with realistic demo data (2 branches, 40 products, 60 items, 2 months of orders)
- [x] Playwright E2E: login → open shift → sell → split pay KHR/USD → refund → close shift
- [x] Permission test suite: each role can only do what the matrix allows (server actions called directly)
- [x] Error boundaries, loading skeletons, empty states, toasts on all mutations
- [x] PWA manifest (installable on tablet) + offline banner (offline selling is **out of scope**)
- [x] Indexes on hot paths (orders by branch/date, movements by item/date, order_lines by kitchen_status)
- [x] Production `Dockerfile`, migrate-on-start script, health check
- [x] `docs/deploy-coolify.md` (§9 step by step), `docs/restore.md`, `docs/operations.md`, short user guide
- [ ] **Accept:** fresh VPS → Coolify → app + Postgres deployed from GitHub over HTTPS; a backup lands in the S3 bucket; a restore to a new database succeeds

---

## 11. Out of scope for v1 (do not build unless asked)
- Offline selling with sync
- WebSockets / push real-time (polling is enough for v1)
- Silent printing / cash drawer via QZ Tray (keep the browser print dialog)
- KHQR / Bakong API integration (record KHQR as a manual payment method with a `reference` field)
- Loyalty points, online ordering, delivery apps
- Full double-entry accounting / general ledger
- Purchase orders before receipt (receipt-first workflow only)
- Batch/expiry tracking

---

## 12. Open questions for the owner (ask before Phase 5 if unanswered)
1. Base currency USD and secondary KHR, correct? Default exchange rate?
2. VAT: on or off by default? Prices tax-inclusive?
3. Refund restock default: no for prepared drinks, yes for resale items — OK?
4. Allow selling into negative stock? (default: allow + warn)
5. Cashier max discount without PIN (default 10%)?
6. Shift variance threshold that needs a manager PIN (default $1.00)?
7. One register per branch, or several?

---

## 13. Definition of done (every phase)
- Migrations generate and apply cleanly on a fresh database (`pnpm db:reset`)
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:int` all pass
- New service functions have integration tests, including a permission-denied case and a wrong-branch case
- UI works at 1024×768 (POS) and 1366×768 (back office)
- Checkboxes in this file updated