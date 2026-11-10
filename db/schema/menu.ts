import { sql } from "drizzle-orm";
import { boolean, check, index, integer, numeric, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./columns";
import { items } from "./inventory";
import { branches, organizations } from "./org";

// Menu (plan §5.3). Menu definitions are organization-wide; prices can be
// overridden per branch. Recipe quantities are in the item's base unit.

const qty = (name: string) => numeric(name, { precision: 18, scale: 4 });
const money = (name: string) => numeric(name, { precision: 18, scale: 4 });

export const KITCHEN_STATIONS = ["bar", "kitchen", "none"] as const;

export const menuCategories = pgTable(
  "menu_categories",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Tile colour on the POS, e.g. "#7c3aed". */
    color: text("color"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("menu_categories_org_name_uq").on(t.orgId, sql`lower(${t.name})`)],
);

export const products = pgTable(
  "products",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    categoryId: uuid("category_id").references(() => menuCategories.id),
    name: text("name").notNull(),
    description: text("description"),
    imageKey: text("image_key"),
    /** bar | kitchen | none */
    kitchenStation: text("kitchen_station").notNull().default("bar"),
    /** false = selling never deducts stock (recipe kept for cost), plan §4.3. */
    deductStock: boolean("deduct_stock").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("products_org_name_uq").on(t.orgId, sql`lower(${t.name})`),
    index("products_category_idx").on(t.categoryId),
    check("products_station_ck", sql`${t.kitchenStation} in ('bar', 'kitchen', 'none')`),
  ],
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: id(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    price: money("price").notNull(),
    sku: text("sku"),
    /** null = follow the product; true/false = override (plan §4.3). */
    deductStock: boolean("deduct_stock"),
    sortOrder: integer("sort_order").notNull().default(0),
    isDefault: boolean("is_default").notNull().default(false),
    /** Removed variants are archived, not deleted, so past orders keep their reference. */
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("product_variants_product_idx").on(t.productId),
    uniqueIndex("product_variants_default_uq").on(t.productId).where(sql`${t.isDefault} and ${t.isActive}`),
    check("product_variants_price_ck", sql`${t.price} >= 0`),
  ],
);

/** Per-branch price override and availability. price null = use the variant's price. */
export const branchVariantPrices = pgTable(
  "branch_variant_prices",
  {
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "cascade" }),
    price: money("price"),
    isAvailable: boolean("is_available").notNull().default(true),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.branchId, t.variantId] }),
    check("branch_variant_prices_price_ck", sql`${t.price} is null or ${t.price} >= 0`),
  ],
);

export const modifierGroups = pgTable(
  "modifier_groups",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    minSelect: integer("min_select").notNull().default(0),
    maxSelect: integer("max_select").notNull().default(1),
    /** Always min_select >= 1; kept as a column for the POS (plan §5.3). */
    isRequired: boolean("is_required").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("modifier_groups_org_name_uq").on(t.orgId, sql`lower(${t.name})`),
    check("modifier_groups_select_ck", sql`${t.minSelect} >= 0 and ${t.maxSelect} >= 1 and ${t.minSelect} <= ${t.maxSelect}`),
    check("modifier_groups_required_ck", sql`${t.isRequired} = (${t.minSelect} >= 1)`),
  ],
);

export const modifiers = pgTable(
  "modifiers",
  {
    id: id(),
    groupId: uuid("group_id").notNull().references(() => modifierGroups.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    priceDelta: money("price_delta").notNull().default("0"),
    deductStock: boolean("deduct_stock").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("modifiers_group_idx").on(t.groupId)],
);

export const productModifierGroups = pgTable(
  "product_modifier_groups",
  {
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").notNull().references(() => modifierGroups.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.productId, t.groupId] })],
);

/**
 * Recipe line of a variant OR a modifier (exactly one). Modifier lines may be
 * negative (substitutions: Oat milk = +200 ml oat milk, −200 ml fresh milk).
 * The entered unit is kept so the editor shows what was typed.
 */
export const recipeLines = pgTable(
  "recipe_lines",
  {
    id: id(),
    variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "cascade" }),
    modifierId: uuid("modifier_id").references(() => modifiers.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull().references(() => items.id),
    qtyBase: qty("qty_base").notNull(),
    unitLabel: text("unit_label").notNull(),
    unitFactor: numeric("unit_factor", { precision: 18, scale: 6 }).notNull(),
    qtyEntered: qty("qty_entered").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index("recipe_lines_variant_idx").on(t.variantId),
    index("recipe_lines_modifier_idx").on(t.modifierId),
    check("recipe_lines_owner_ck", sql`num_nonnulls(${t.variantId}, ${t.modifierId}) = 1`),
    check("recipe_lines_qty_ck", sql`${t.qtyBase} <> 0 and (${t.modifierId} is not null or ${t.qtyBase} > 0)`),
  ],
);
