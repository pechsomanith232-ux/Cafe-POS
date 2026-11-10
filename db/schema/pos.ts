import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { createdAt, id, updatedAt } from "./columns";
import { modifierGroups, modifiers, products, productVariants } from "./menu";
import { branches, organizations } from "./org";
import { currencies, paymentMethods } from "./purchasing";

// POS (plan §5.4). Phase 5: registers, shifts, tables, orders up to "sent to
// kitchen" / held. Payments, refunds and cash movements arrive in Phase 6.

const money = (name: string) => numeric(name, { precision: 18, scale: 4 });

export const ORDER_STATUSES = ["open", "held", "paid", "voided", "refunded", "partially_refunded"] as const;
export const ORDER_TYPES = ["dine_in", "takeaway"] as const;
export const KITCHEN_STATUSES = ["pending", "preparing", "ready", "served"] as const;
export const DISCOUNT_TYPES = ["percent", "amount"] as const;

export const registers = pgTable(
  "registers",
  {
    id: id(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("registers_branch_name_uq").on(t.branchId, sql`lower(${t.name})`)],
);

export const shifts = pgTable(
  "shifts",
  {
    id: id(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    registerId: uuid("register_id").notNull().references(() => registers.id),
    openedBy: text("opened_by").notNull().references(() => user.id),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    closedBy: text("closed_by").references(() => user.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** open | closed */
    status: text("status").notNull().default("open"),
    notes: text("notes"),
  },
  (t) => [
    // One open shift per register.
    uniqueIndex("shifts_register_open_uq").on(t.registerId).where(sql`${t.status} = 'open'`),
    index("shifts_branch_idx").on(t.branchId, t.openedAt),
    check("shifts_status_ck", sql`${t.status} in ('open', 'closed')`),
  ],
);

export const shiftCash = pgTable(
  "shift_cash",
  {
    shiftId: uuid("shift_id").notNull().references(() => shifts.id, { onDelete: "cascade" }),
    currencyCode: text("currency_code").notNull().references(() => currencies.code),
    openingFloat: money("opening_float").notNull().default("0"),
    expected: money("expected"),
    counted: money("counted"),
    variance: money("variance"),
  },
  (t) => [primaryKey({ columns: [t.shiftId, t.currencyCode] }), check("shift_cash_float_ck", sql`${t.openingFloat} >= 0`)],
);

export const diningTables = pgTable(
  "dining_tables",
  {
    id: id(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    name: text("name").notNull(),
    area: text("area"),
    seats: integer("seats"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("dining_tables_branch_name_uq").on(t.branchId, sql`lower(${t.name})`)],
);

/** Daily order counter per branch, locked FOR UPDATE when numbering an order. */
export const orderCounters = pgTable(
  "order_counters",
  {
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    lastNo: integer("last_no").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.branchId, t.businessDate] })],
);

/** KHR (etc.) per 1 unit of base currency, with history (plan §4.4). The latest effective row applies. */
export const exchangeRates = pgTable(
  "exchange_rates",
  {
    id: id(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    currencyCode: text("currency_code").notNull().references(() => currencies.code),
    rateToBase: numeric("rate_to_base", { precision: 18, scale: 6 }).notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("exchange_rates_lookup_idx").on(t.branchId, t.currencyCode, t.effectiveFrom),
    check("exchange_rates_positive_ck", sql`${t.rateToBase} > 0`),
  ],
);

export const discountReasons = pgTable(
  "discount_reasons",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [uniqueIndex("discount_reasons_org_name_uq").on(t.orgId, sql`lower(${t.name})`)],
);

export const customers = pgTable(
  "customers",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    phone: text("phone"),
    /** Max unpaid account balance; null = can't charge to account. */
    creditLimit: money("credit_limit"),
    note: text("note"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("customers_org_name_idx").on(t.orgId, t.name), check("customers_limit_ck", sql`${t.creditLimit} is null or ${t.creditLimit} >= 0`)],
);

export const orders = pgTable(
  "orders",
  {
    id: id(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    shiftId: uuid("shift_id").notNull().references(() => shifts.id),
    orderNo: text("order_no").notNull(),
    queueNo: integer("queue_no").notNull(),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    orderType: text("order_type").notNull().default("takeaway"),
    tableId: uuid("table_id").references(() => diningTables.id),
    customerId: uuid("customer_id").references(() => customers.id),
    status: text("status").notNull().default("open"),
    subtotal: money("subtotal").notNull().default("0"),
    discountType: text("discount_type"),
    discountValue: money("discount_value"),
    discountReason: text("discount_reason"),
    /** Line discounts + order discount. */
    discountTotal: money("discount_total").notNull().default("0"),
    orderDiscountAmount: money("order_discount_amount").notNull().default("0"),
    taxTotal: money("tax_total").notNull().default("0"),
    total: money("total").notNull().default("0"),
    paidTotal: money("paid_total").notNull().default("0"),
    refundedTotal: money("refunded_total").notNull().default("0"),
    /** Charged to the customer's account and not yet paid (AR, plan §4.10). */
    accountDue: money("account_due").notNull().default("0"),
    /** Tax settings snapshotted at the last save. */
    taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    taxInclusive: boolean("tax_inclusive").notNull().default(true),
    note: text("note"),
    heldAt: timestamp("held_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    voidedBy: text("voided_by").references(() => user.id),
    /** Manager who approved a discount above the cashier's limit. */
    approvedBy: text("approved_by").references(() => user.id),
    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("orders_branch_no_uq").on(t.branchId, t.orderNo),
    index("orders_branch_status_idx").on(t.branchId, t.status),
    index("orders_shift_idx").on(t.shiftId),
    // Hot paths: sales reports filter by branch + paid date, order lists by branch + created date.
    index("orders_branch_paid_idx").on(t.branchId, t.paidAt),
    index("orders_branch_created_idx").on(t.branchId, t.createdAt),
    check("orders_status_ck", sql`${t.status} in ('open', 'held', 'paid', 'voided', 'refunded', 'partially_refunded')`),
    check("orders_type_ck", sql`${t.orderType} in ('dine_in', 'takeaway')`),
    check("orders_discount_type_ck", sql`${t.discountType} is null or ${t.discountType} in ('percent', 'amount')`),
  ],
);

export const orderLines = pgTable(
  "order_lines",
  {
    id: id(),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    productNameSnapshot: text("product_name_snapshot").notNull(),
    variantNameSnapshot: text("variant_name_snapshot").notNull(),
    qty: integer("qty").notNull(),
    unitPrice: money("unit_price").notNull(),
    modifiersTotal: money("modifiers_total").notNull().default("0"),
    lineDiscountType: text("line_discount_type"),
    lineDiscountValue: money("line_discount_value"),
    lineDiscountReason: text("line_discount_reason"),
    lineDiscountAmount: money("line_discount_amount").notNull().default("0"),
    /** Share of the order-level discount (plan §4.5), for profit reporting. */
    discountAlloc: money("discount_alloc").notNull().default("0"),
    taxAmount: money("tax_amount").notNull().default("0"),
    lineTotal: money("line_total").notNull(),
    /** Effective deduct_stock snapshotted at sale (plan §4.3). */
    deductStock: boolean("deduct_stock").notNull(),
    costTotal: money("cost_total"),
    costSource: text("cost_source"),
    note: text("note"),
    kitchenStation: text("kitchen_station").notNull(),
    kitchenStatus: text("kitchen_status").notNull().default("pending"),
    /** null until "Send to kitchen"; sent lines are locked in the cart. */
    sentToKitchenAt: timestamp("sent_to_kitchen_at", { withTimezone: true }),
    kitchenUpdatedAt: timestamp("kitchen_updated_at", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
    refundedQty: integer("refunded_qty").notNull().default(0),
  },
  (t) => [
    index("order_lines_order_idx").on(t.orderId),
    index("order_lines_kitchen_idx").on(t.kitchenStatus, t.sentToKitchenAt),
    check("order_lines_qty_ck", sql`${t.qty} > 0`),
    check("order_lines_kitchen_ck", sql`${t.kitchenStatus} in ('pending', 'preparing', 'ready', 'served')`),
    check("order_lines_discount_type_ck", sql`${t.lineDiscountType} is null or ${t.lineDiscountType} in ('percent', 'amount')`),
    check("order_lines_cost_source_ck", sql`${t.costSource} is null or ${t.costSource} in ('actual', 'theoretical', 'none')`),
  ],
);

export const orderLineModifiers = pgTable(
  "order_line_modifiers",
  {
    id: id(),
    orderLineId: uuid("order_line_id").notNull().references(() => orderLines.id, { onDelete: "cascade" }),
    modifierId: uuid("modifier_id").notNull().references(() => modifiers.id),
    groupId: uuid("group_id").notNull().references(() => modifierGroups.id),
    nameSnapshot: text("name_snapshot").notNull(),
    priceDelta: money("price_delta").notNull(),
    deductStock: boolean("deduct_stock").notNull(),
  },
  (t) => [index("order_line_modifiers_line_idx").on(t.orderLineId)],
);

/**
 * Money received or paid back for an order (plan §5.4). Change and rounding
 * are recorded on the cash tender that produced them. Net received =
 * amount_base − change_base = (share of) total + rounding_base.
 */
export const payments = pgTable(
  "payments",
  {
    id: id(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    shiftId: uuid("shift_id").notNull().references(() => shifts.id),
    methodId: uuid("method_id").notNull().references(() => paymentMethods.id),
    /** Method type snapshot: cash | khqr | card | bank_transfer | account | other */
    methodType: text("method_type").notNull(),
    currencyCode: text("currency_code").notNull().references(() => currencies.code),
    amountTendered: money("amount_tendered").notNull(),
    rateUsed: numeric("rate_used", { precision: 18, scale: 6 }).notNull(),
    amountBase: money("amount_base").notNull(),
    changeCurrency: text("change_currency").references(() => currencies.code),
    changeAmount: money("change_amount").notNull().default("0"),
    changeBase: money("change_base").notNull().default("0"),
    roundingBase: money("rounding_base").notNull().default("0"),
    reference: text("reference"),
    isRefund: boolean("is_refund").notNull().default(false),
    refundId: uuid("refund_id").references(() => refunds.id),
    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index("payments_order_idx").on(t.orderId), index("payments_shift_idx").on(t.shiftId)],
);

export const refunds = pgTable(
  "refunds",
  {
    id: id(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    shiftId: uuid("shift_id").notNull().references(() => shifts.id),
    reason: text("reason").notNull(),
    approvedBy: text("approved_by").notNull().references(() => user.id),
    totalBase: money("total_base").notNull(),
    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index("refunds_order_idx").on(t.orderId)],
);

export const refundLines = pgTable(
  "refund_lines",
  {
    id: id(),
    refundId: uuid("refund_id").notNull().references(() => refunds.id, { onDelete: "cascade" }),
    orderLineId: uuid("order_line_id").notNull().references(() => orderLines.id),
    qty: integer("qty").notNull(),
    amount: money("amount").notNull(),
    restock: boolean("restock").notNull(),
  },
  (t) => [index("refund_lines_refund_idx").on(t.refundId), check("refund_lines_qty_ck", sql`${t.qty} > 0`)],
);

/** Cash pay-in / pay-out during a shift (plan §4.8). */
export const cashMovements = pgTable(
  "cash_movements",
  {
    id: id(),
    shiftId: uuid("shift_id").notNull().references(() => shifts.id),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    type: text("type").notNull(),
    currencyCode: text("currency_code").notNull().references(() => currencies.code),
    amount: money("amount").notNull(),
    reason: text("reason").notNull(),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("cash_movements_shift_idx").on(t.shiftId),
    check("cash_movements_type_ck", sql`${t.type} in ('pay_in', 'pay_out')`),
    check("cash_movements_amount_ck", sql`${t.amount} > 0`),
  ],
);

/** Customer payments against charged orders (AR, plan §5.6). */
export const customerPayments = pgTable(
  "customer_payments",
  {
    id: id(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    shiftId: uuid("shift_id").references(() => shifts.id),
    paymentDate: date("payment_date", { mode: "string" }).notNull(),
    methodId: uuid("method_id").notNull().references(() => paymentMethods.id),
    currencyCode: text("currency_code").notNull().references(() => currencies.code),
    amount: money("amount").notNull(),
    rateUsed: numeric("rate_used", { precision: 18, scale: 6 }).notNull(),
    amountBase: money("amount_base").notNull(),
    unallocatedBase: money("unallocated_base").notNull().default("0"),
    reference: text("reference"),
    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index("customer_payments_customer_idx").on(t.customerId), check("customer_payments_amount_ck", sql`${t.amount} > 0`)],
);

export const customerPaymentAllocations = pgTable(
  "customer_payment_allocations",
  {
    id: id(),
    paymentId: uuid("payment_id").notNull().references(() => customerPayments.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    amountBase: money("amount_base").notNull(),
  },
  (t) => [index("customer_payment_allocations_order_idx").on(t.orderId), check("customer_payment_allocations_amount_ck", sql`${t.amountBase} > 0`)],
);
