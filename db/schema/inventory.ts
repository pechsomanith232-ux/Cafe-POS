import {
  bigint,
  boolean,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";
import { createdAt, id, updatedAt } from "./columns";
import { branches, organizations } from "./org";

// Units and inventory (plan §5.2). Quantities are ALWAYS stored in the item's
// base unit (plan §2.4). numeric: qty (18,4), cost per base unit (18,6),
// money (18,4) (plan §2.5).

const qty = (name: string) => numeric(name, { precision: 18, scale: 4 });
const unitCost = (name: string) => numeric(name, { precision: 18, scale: 6 });
const money = (name: string) => numeric(name, { precision: 18, scale: 4 });

/** Global units with fixed factors: pcs, ml, L(1000 ml), g, kg(1000 g). */
export const units = pgTable("units", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  /** count | volume | mass */
  dimension: text("dimension").notNull(),
  /** Factor to the dimension's base unit (ml, g, pcs). */
  factorToDimensionBase: numeric("factor_to_dimension_base", { precision: 18, scale: 6 }).notNull(),
  createdAt: createdAt(),
});

export const itemCategories = pgTable(
  "item_categories",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("item_categories_org_name_uq").on(t.orgId, sql`lower(${t.name})`)],
);

export const items = pgTable(
  "items",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    sku: text("sku"),
    name: text("name").notNull(),
    categoryId: uuid("category_id").references(() => itemCategories.id),
    baseUnitId: uuid("base_unit_id").notNull().references(() => units.id),
    /** ingredient | resale | packaging | other */
    itemType: text("item_type").notNull().default("ingredient"),
    /** Supplier table arrives in Phase 3; FK added then. */
    defaultSupplierId: uuid("default_supplier_id"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("items_org_sku_uq").on(t.orgId, sql`lower(${t.sku})`).where(sql`${t.sku} is not null`),
    index("items_org_name_idx").on(t.orgId, t.name),
  ],
);

/** Item-specific packaging units, e.g. Fresh Milk: bottle = 1000 ml, case = 12000 ml. */
export const itemUnits = pgTable(
  "item_units",
  {
    id: id(),
    itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    factorToBase: numeric("factor_to_base", { precision: 18, scale: 6 }).notNull(),
    isPurchaseDefault: boolean("is_purchase_default").notNull().default(false),
    isCountDefault: boolean("is_count_default").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("item_units_item_name_uq").on(t.itemId, sql`lower(${t.name})`)],
);

/**
 * Current stock per item per branch. Changed ONLY by applyStockMovement
 * (lib/services/stock.ts), except reorder_level which is a setting.
 */
export const stockLevels = pgTable(
  "stock_levels",
  {
    id: id(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    itemId: uuid("item_id").notNull().references(() => items.id),
    qtyOnHand: qty("qty_on_hand").notNull().default("0"),
    avgCost: unitCost("avg_cost").notNull().default("0"),
    reorderLevel: qty("reorder_level"),
    lastCost: unitCost("last_cost"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("stock_levels_branch_item_uq").on(t.branchId, t.itemId)],
);

/** Append-only stock ledger (plan §2.3). A trigger blocks UPDATE/DELETE. */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: id(),
    /** Insertion order: stable sort key for history and running balances. */
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    itemId: uuid("item_id").notNull().references(() => items.id),
    /** opening|purchase|purchase_return|sale|refund_restock|adjustment_in|adjustment_out|waste|count_adjustment|transfer_out|transfer_in */
    movementType: text("movement_type").notNull(),
    /** Signed, in base unit: + in, − out. */
    qtyBase: qty("qty_base").notNull(),
    unitCost: unitCost("unit_cost").notNull(),
    /** Signed: qty_base × unit_cost. For outbound this is the COGS (negative). */
    totalCost: money("total_cost").notNull(),
    qtyAfter: qty("qty_after").notNull(),
    avgCostAfter: unitCost("avg_cost_after").notNull(),
    enteredUnitLabel: text("entered_unit_label"),
    enteredQty: qty("entered_qty"),
    refType: text("ref_type"),
    refId: text("ref_id"),
    reason: text("reason"),
    createdBy: text("created_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("stock_movements_branch_item_created_idx").on(t.branchId, t.itemId, t.createdAt),
    index("stock_movements_branch_created_idx").on(t.branchId, t.createdAt),
    index("stock_movements_branch_seq_idx").on(t.branchId, t.seq),
    index("stock_movements_ref_idx").on(t.refType, t.refId),
  ],
);

export const stockAdjustments = pgTable(
  "stock_adjustments",
  {
    id: id(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    /** waste | damage | expired | staff_meal | correction | other */
    reasonCode: text("reason_code").notNull(),
    note: text("note"),
    /** draft | posted */
    status: text("status").notNull().default("draft"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    postedBy: text("posted_by").references(() => user.id),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("stock_adjustments_branch_idx").on(t.branchId, t.createdAt)],
);

export const stockAdjustmentLines = pgTable("stock_adjustment_lines", {
  id: id(),
  adjustmentId: uuid("adjustment_id").notNull().references(() => stockAdjustments.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").notNull().references(() => items.id),
  enteredUnitLabel: text("entered_unit_label").notNull(),
  /** Signed: + adds stock, − removes stock. */
  enteredQty: qty("entered_qty").notNull(),
  qtyBase: qty("qty_base").notNull(),
  /** Optional cost per base unit for additions; null = current average. */
  unitCost: unitCost("unit_cost"),
  /** Exact value of an addition (entered qty × entered cost), used for WAC. */
  totalCost: money("total_cost"),
  note: text("note"),
});

export const stockCounts = pgTable(
  "stock_counts",
  {
    id: id(),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    categoryId: uuid("category_id").references(() => itemCategories.id),
    /** draft | posted | cancelled */
    status: text("status").notNull().default("draft"),
    note: text("note"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    postedBy: text("posted_by").references(() => user.id),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("stock_counts_branch_idx").on(t.branchId, t.createdAt)],
);

export const stockCountLines = pgTable(
  "stock_count_lines",
  {
    id: id(),
    countId: uuid("count_id").notNull().references(() => stockCounts.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull().references(() => items.id),
    /** System quantity when the count was created (snapshot). */
    systemQty: qty("system_qty").notNull(),
    countedQtyBase: qty("counted_qty_base"),
    enteredUnitLabel: text("entered_unit_label"),
    enteredQty: qty("entered_qty"),
    diff: qty("diff"),
  },
  (t) => [uniqueIndex("stock_count_lines_count_item_uq").on(t.countId, t.itemId)],
);

/**
 * Stock transfer between two branches of the org (plan §4.12):
 * draft → sent (transfer_out at the sender's average) → received (transfer_in
 * at the same cost; any shortfall is recorded as loss). Value is conserved:
 * value_sent = value_received + loss_value on every line.
 */
export const stockTransfers = pgTable(
  "stock_transfers",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    /** Shown as TR-000123. */
    number: bigint("number", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    fromBranchId: uuid("from_branch_id").notNull().references(() => branches.id),
    toBranchId: uuid("to_branch_id").notNull().references(() => branches.id),
    /** draft | sent | received | cancelled */
    status: text("status").notNull().default("draft"),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id),
    sentBy: text("sent_by").references(() => user.id),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    receivedBy: text("received_by").references(() => user.id),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("stock_transfers_from_idx").on(t.fromBranchId, t.createdAt), index("stock_transfers_to_idx").on(t.toBranchId, t.createdAt)],
);

export const stockTransferLines = pgTable(
  "stock_transfer_lines",
  {
  id: id(),
  transferId: uuid("transfer_id").notNull().references(() => stockTransfers.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").notNull().references(() => items.id),
  enteredUnitLabel: text("entered_unit_label").notNull(),
  enteredQty: qty("entered_qty").notNull(),
  qtySent: qty("qty_sent").notNull(),
  qtyReceived: qty("qty_received"),
  /** Sender's average cost per base unit at sending. */
  unitCost: unitCost("unit_cost"),
  valueSent: money("value_sent"),
  valueReceived: money("value_received"),
  lossValue: money("loss_value"),
  },
  (t) => [index("stock_transfer_lines_transfer_idx").on(t.transferId)],
);
