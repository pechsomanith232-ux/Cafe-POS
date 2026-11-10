import { sql } from "drizzle-orm";
import { bigint, boolean, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { createdAt, id, updatedAt } from "./columns";
import { items } from "./inventory";
import { branches, organizations } from "./org";

// Purchasing and accounts payable (plan §4.9, §5.5). Money in base currency
// (USD) as numeric(18,4); quantities numeric(18,4); unit costs numeric(18,6).

const money = (name: string) => numeric(name, { precision: 18, scale: 4 });
const qty = (name: string) => numeric(name, { precision: 18, scale: 4 });
const unitCost = (name: string) => numeric(name, { precision: 18, scale: 6 });

/** Currencies (plan §5.4). Seeded: USD (base, 2 dp), KHR (0 dp, cash rounding 100). */
export const currencies = pgTable("currencies", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
  decimals: integer("decimals").notNull(),
  cashRounding: numeric("cash_rounding", { precision: 18, scale: 4 }).notNull(),
});

/** Payment methods (plan §5.4). Seeded per organization; settings UI in Phase 6. */
export const paymentMethods = pgTable(
  "payment_methods",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    /** Each branch keeps its own list (owner's answer, 2026-11-10). */
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    name: text("name").notNull(),
    /** cash | khqr | card | bank_transfer | account | other */
    type: text("type").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("payment_methods_branch_name_uq").on(t.branchId, sql`lower(${t.name})`)],
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    paymentTermsDays: integer("payment_terms_days").notNull().default(0),
    note: text("note"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("suppliers_org_name_uq").on(t.orgId, sql`lower(${t.name})`)],
);

/** Goods receipt = supplier invoice (credit) or a pay-now purchase (direct). */
export const goodsReceipts = pgTable(
  "goods_receipts",
  {
    id: id(),
    /** Human-readable running number, shown as GR-000123. */
    number: bigint("number", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    /** credit | direct */
    purchaseType: text("purchase_type").notNull(),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    supplierNameText: text("supplier_name_text"),
    supplierInvoiceNo: text("supplier_invoice_no"),
    receiptDate: date("receipt_date", { mode: "string" }).notNull(),
    paymentTermsDays: integer("payment_terms_days"),
    dueDate: date("due_date", { mode: "string" }),
    /** Shift whose drawer paid a direct purchase (Phase 6). */
    paidFromShiftId: uuid("paid_from_shift_id"),
    /** draft | posted | cancelled */
    status: text("status").notNull().default("draft"),
    subtotal: money("subtotal").notNull().default("0"),
    extraCosts: money("extra_costs").notNull().default("0"),
    total: money("total").notNull().default("0"),
    /** Paid or credited (allocations, incl. return credits). */
    amountPaid: money("amount_paid").notNull().default("0"),
    amountDue: money("amount_due").notNull().default("0"),
    returnedTotal: money("returned_total").notNull().default("0"),
    /** Sub-cent balance written off when a foreign-currency payment leaves less than $0.01 due. */
    roundingBase: money("rounding_base").notNull().default("0"),
    /** unpaid | partial | paid */
    paymentStatus: text("payment_status").notNull().default("unpaid"),
    note: text("note"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    postedBy: text("posted_by").references(() => user.id),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("goods_receipts_branch_date_idx").on(t.branchId, t.receiptDate),
    index("goods_receipts_supplier_idx").on(t.supplierId, t.status),
  ],
);

export const goodsReceiptLines = pgTable("goods_receipt_lines", {
  id: id(),
  receiptId: uuid("receipt_id").notNull().references(() => goodsReceipts.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").notNull().references(() => items.id),
  /** Entered unit (label + factor at the time, so later unit edits don't change history). */
  unitLabel: text("unit_label").notNull(),
  unitFactor: numeric("unit_factor", { precision: 18, scale: 6 }).notNull(),
  qtyEntered: qty("qty_entered").notNull(),
  qtyBase: qty("qty_base").notNull(),
  unitCostEntered: unitCost("unit_cost_entered").notNull(),
  lineTotal: money("line_total").notNull(),
  allocatedExtra: money("allocated_extra").notNull().default("0"),
  landedTotal: money("landed_total").notNull().default("0"),
  landedUnitCostBase: unitCost("landed_unit_cost_base").notNull().default("0"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const goodsReceiptExtraCosts = pgTable("goods_receipt_extra_costs", {
  id: id(),
  receiptId: uuid("receipt_id").notNull().references(() => goodsReceipts.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  amount: money("amount").notNull(),
});

/** Return of received goods to the supplier (posted immediately). */
export const supplierReturns = pgTable(
  "supplier_returns",
  {
    id: id(),
    number: bigint("number", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    receiptId: uuid("receipt_id").notNull().references(() => goodsReceipts.id),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    returnDate: date("return_date", { mode: "string" }).notNull(),
    reason: text("reason").notNull(),
    total: money("total").notNull(),
    /** Credit receipts: the supplier credit created (a supplier_payments row of kind return_credit). */
    creditPaymentId: uuid("credit_payment_id"),
    /** Direct receipts: refund received instead of a credit. */
    refundMethodId: uuid("refund_method_id").references(() => paymentMethods.id),
    refundCurrency: text("refund_currency").references(() => currencies.code),
    refundAmount: money("refund_amount"),
    refundRate: numeric("refund_rate", { precision: 18, scale: 6 }),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index("supplier_returns_receipt_idx").on(t.receiptId)],
);

export const supplierReturnLines = pgTable("supplier_return_lines", {
  id: id(),
  returnId: uuid("return_id").notNull().references(() => supplierReturns.id, { onDelete: "cascade" }),
  receiptLineId: uuid("receipt_line_id").notNull().references(() => goodsReceiptLines.id),
  itemId: uuid("item_id").notNull().references(() => items.id),
  unitLabel: text("unit_label").notNull(),
  qtyEntered: qty("qty_entered").notNull(),
  qtyBase: qty("qty_base").notNull(),
  unitCostBase: unitCost("unit_cost_base").notNull(),
  lineTotal: money("line_total").notNull(),
});

/**
 * Money paid to a supplier (kind "payment"), or a credit from a supplier
 * return (kind "return_credit"). `unallocated_base` = supplier credit balance.
 */
export const supplierPayments = pgTable(
  "supplier_payments",
  {
    id: id(),
    number: bigint("number", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    kind: text("kind").notNull().default("payment"),
    paymentDate: date("payment_date", { mode: "string" }).notNull(),
    methodId: uuid("method_id").references(() => paymentMethods.id),
    currencyCode: text("currency_code").notNull().references(() => currencies.code),
    amount: money("amount").notNull(),
    /** Units of currency per 1 USD (KHR ≈ 4100); 1 for USD. */
    rateUsed: numeric("rate_used", { precision: 18, scale: 6 }).notNull(),
    amountBase: money("amount_base").notNull(),
    unallocatedBase: money("unallocated_base").notNull(),
    reference: text("reference"),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index("supplier_payments_supplier_idx").on(t.supplierId, t.paymentDate)],
);

export const supplierPaymentAllocations = pgTable(
  "supplier_payment_allocations",
  {
    id: id(),
    paymentId: uuid("payment_id").notNull().references(() => supplierPayments.id),
    receiptId: uuid("receipt_id").notNull().references(() => goodsReceipts.id),
    amountBase: money("amount_base").notNull(),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index("supplier_payment_allocations_receipt_idx").on(t.receiptId), index("supplier_payment_allocations_payment_idx").on(t.paymentId)],
);
