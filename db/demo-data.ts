// Realistic demo data (plan Phase 9): 2 branches, 60 items, 40 products and
// ~2 months of trading. Every day is played through the real service layer
// "today" and then moved back in time, so stock, WAC, AP and shift cash are
// exactly what the app itself would have produced.
import { and, asc, eq, sql } from "drizzle-orm";
import type { Executor } from "./client";
import {
  branches, goodsReceipts, modifiers, orderLines, organizations, paymentMethods, productVariants, products,
  registers, roles, stockLevels, stockTransferLines, user, userBranchRoles,
} from "./schema";
import { insertAuthUser } from "@/lib/auth-users";
import { buildContext } from "@/lib/context-builder";
import { addDays, todayLocal } from "@/lib/dates";
import { dec } from "@/lib/domain/money";
import type { AppContext } from "@/lib/permissions";
import { createBranch } from "@/lib/services/branches";
import { currencyAt } from "@/lib/services/currency-rates";
import { recordCustomerPayment, saveCustomer } from "@/lib/services/customers";
import {
  createAdjustment, createCategory, createCount, createItem, postAdjustment, postCount, saveCountLines,
  setOpeningStock, setReorderLevel,
} from "@/lib/services/inventory";
import { createMenuCategory, saveModifierGroup, saveProduct, setBranchVariantPrice } from "@/lib/services/menu";
import { saveOrder } from "@/lib/services/orders";
import { payOrder, refundOrder, voidOrder } from "@/lib/services/payments";
import { createSupplier, recordSupplierPayment, saveAndPostReceipt } from "@/lib/services/purchasing";
import { expectedCash } from "@/lib/services/shift-cash";
import { closeShift, openShift } from "@/lib/services/shifts";
import { createTransfer, receiveTransfer } from "@/lib/services/transfers";
import { setUserPin } from "@/lib/services/users";

const TZ = "Asia/Phnom_Penh";

// ---------- catalogue ----------

const SUPPLIERS: [name: string, termsDays: number][] = [
  ["Kampot Coffee Roasters", 30], ["Phnom Penh Dairy", 15], ["Mekong Fresh Produce", 7], ["Angkor Packaging", 30], ["Sweet Supply Co.", 15],
];
/** Supplier index -1 = bought at the market, paid from the drawer (direct purchase). */
const MARKET = -1;

type ItemSeed = [name: string, base: "g" | "ml" | "pcs", unit: string, factor: number, cost: number, supplier: number, type?: "resale" | "packaging"];
const ITEMS: Record<string, ItemSeed[]> = {
  "Coffee & Tea": [
    ["Espresso Beans", "g", "bag", 1000, 14, 0], ["Decaf Beans", "g", "bag", 1000, 16, 0], ["Cold Brew Beans", "g", "bag", 1000, 13, 0],
    ["Black Tea", "g", "pack", 500, 6, 0], ["Green Tea", "g", "pack", 500, 7, 0], ["Matcha Powder", "g", "tin", 100, 9, 0],
    ["Cocoa Powder", "g", "bag", 1000, 8, 0], ["Chai Concentrate", "ml", "bottle", 1000, 6.5, 0], ["Thai Tea Mix", "g", "bag", 400, 4, 0],
  ],
  Dairy: [
    ["Fresh Milk", "ml", "case", 12000, 18, 1], ["Oat Milk", "ml", "carton", 1000, 3.2, 1], ["Almond Milk", "ml", "carton", 1000, 3, 1],
    ["Soy Milk", "ml", "carton", 1000, 1.9, 1], ["Condensed Milk", "g", "can", 390, 1.1, 1], ["Whipping Cream", "ml", "carton", 1000, 4.5, 1],
    ["Butter", "g", "block", 250, 2.8, 1], ["Cream Cheese", "g", "block", 1000, 7.5, 1], ["Yogurt", "g", "tub", 1000, 3.2, 1], ["Eggs", "pcs", "tray", 30, 3.9, 1],
  ],
  "Syrups & Sweeteners": [
    ["Vanilla Syrup", "ml", "bottle", 750, 6, 4], ["Caramel Syrup", "ml", "bottle", 750, 6, 4], ["Hazelnut Syrup", "ml", "bottle", 750, 6, 4],
    ["Chocolate Sauce", "ml", "bottle", 1000, 7, 4], ["Caramel Sauce", "ml", "bottle", 1000, 7.5, 4], ["Honey", "g", "jar", 500, 5, 4],
    ["White Sugar", "g", "bag", 1000, 1.1, 4], ["Brown Sugar", "g", "bag", 1000, 1.4, 4], ["Palm Sugar Syrup", "ml", "bottle", 1000, 3, 4],
    ["Strawberry Puree", "ml", "bottle", 1000, 6.8, 4], ["Mango Puree", "ml", "bottle", 1000, 6.2, 4], ["Passion Fruit Puree", "ml", "bottle", 1000, 6.5, 4],
  ],
  Produce: [
    ["Lime", "pcs", "bag", 20, 1.5, MARKET], ["Lemon", "pcs", "bag", 10, 2.5, 2], ["Banana", "pcs", "bunch", 12, 1.8, 2], ["Mango", "pcs", "crate", 10, 5, 2],
    ["Avocado", "pcs", "box", 10, 6, 2], ["Mint Leaves", "g", "bunch", 100, 0.8, MARKET], ["Ice", "g", "bag", 10000, 1.2, MARKET],
    ["Coconut Water", "ml", "carton", 1000, 1.8, 2], ["Orange", "pcs", "bag", 20, 5, 2],
  ],
  "Bakery & Food": [
    ["Flour", "g", "bag", 1000, 1, 4], ["Bread Slice", "pcs", "loaf", 20, 2.2, 4], ["Croissant (frozen)", "pcs", "box", 30, 13.5, 4], ["Ham", "g", "pack", 500, 4.5, 4],
    ["Cheddar Cheese", "g", "block", 1000, 8.5, 4], ["Chocolate Chips", "g", "bag", 1000, 7, 4], ["Oats", "g", "bag", 1000, 2.2, 4],
  ],
  Resale: [
    ["Bottled Water 500ml", "pcs", "case", 24, 4.8, 4, "resale"], ["Sparkling Water", "pcs", "case", 24, 12, 4, "resale"], ["Canned Cola", "pcs", "case", 24, 9.6, 4, "resale"],
    ["Banana Bread Slice", "pcs", "tray", 10, 6, 4, "resale"], ["Chocolate Muffin", "pcs", "tray", 12, 8.4, 4, "resale"], ["Butter Cookie", "pcs", "box", 24, 7.2, 4, "resale"],
  ],
  Packaging: [
    ["Hot Cup 8oz", "pcs", "sleeve", 50, 2.5, 3, "packaging"], ["Hot Cup 12oz", "pcs", "sleeve", 50, 3, 3, "packaging"], ["Cold Cup 16oz", "pcs", "sleeve", 50, 3.5, 3, "packaging"],
    ["Cup Lid", "pcs", "sleeve", 100, 2, 3, "packaging"], ["Straw", "pcs", "box", 500, 4, 3, "packaging"], ["Paper Bag", "pcs", "pack", 100, 3, 3, "packaging"],
    ["Napkin", "pcs", "pack", 500, 2.5, 3, "packaging"],
  ],
};

type Recipe = Record<string, number>;
type VariantSeed = [name: string, price: number, recipe: Recipe];
type ProductSeed = { name: string; station: "bar" | "kitchen" | "none"; variants: VariantSeed[]; milk?: boolean; extras?: boolean; deduct?: boolean };

const scale = (r: Recipe, f: number): Recipe => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v * f)]));
/** Hot drink in Regular (8oz) and Large (12oz). */
const hot = (name: string, price: number, r: Recipe, milk = true): ProductSeed => ({
  name, station: "bar", milk, extras: true,
  variants: [
    ["Regular", price, { ...r, "Hot Cup 8oz": 1, "Cup Lid": 1 }],
    ["Large", price + 0.6, { ...scale(r, 1.5), "Hot Cup 12oz": 1, "Cup Lid": 1 }],
  ],
});
/** Iced drink, one 16oz size. */
const iced = (name: string, price: number, r: Recipe, milk = true): ProductSeed => ({
  name, station: "bar", milk, extras: true,
  variants: [["Regular", price, { ...r, Ice: 150, "Cold Cup 16oz": 1, "Cup Lid": 1, Straw: 1 }]],
});
const simple = (name: string, price: number, r: Recipe, station: ProductSeed["station"] = "none"): ProductSeed => ({ name, station, variants: [["Each", price, r]] });
const B = "Espresso Beans";
const M = "Fresh Milk";

const MENU: Record<string, ProductSeed[]> = {
  "Hot Coffee": [
    hot("Latte", 2.75, { [B]: 18, [M]: 180 }),
    hot("Cappuccino", 2.75, { [B]: 18, [M]: 150 }),
    hot("Americano", 2, { [B]: 18 }, false),
    { name: "Espresso", station: "bar", extras: true, variants: [["Single", 1.5, { [B]: 18 }], ["Double", 2, { [B]: 36 }]] },
    hot("Flat White", 3, { [B]: 27, [M]: 140 }),
    hot("Mocha", 3.25, { [B]: 18, [M]: 160, "Chocolate Sauce": 25 }),
    hot("Caramel Macchiato", 3.5, { [B]: 18, [M]: 170, "Caramel Syrup": 15, "Caramel Sauce": 10 }),
    hot("Vanilla Latte", 3.25, { [B]: 18, [M]: 180, "Vanilla Syrup": 20 }),
  ],
  "Iced Coffee": [
    iced("Iced Latte", 3, { [B]: 18, [M]: 200 }),
    iced("Iced Americano", 2.25, { [B]: 18 }, false),
    iced("Khmer Iced Coffee", 2, { [B]: 20, "Condensed Milk": 40 }, false),
    iced("Iced Mocha", 3.5, { [B]: 18, [M]: 180, "Chocolate Sauce": 30 }),
    iced("Iced Caramel Latte", 3.5, { [B]: 18, [M]: 190, "Caramel Syrup": 20 }),
    iced("Iced Hazelnut Latte", 3.5, { [B]: 18, [M]: 190, "Hazelnut Syrup": 20 }),
    iced("Cold Brew", 2.75, { "Cold Brew Beans": 25 }, false),
    iced("Coconut Cold Brew", 3.25, { "Cold Brew Beans": 25, "Coconut Water": 150 }, false),
  ],
  "Tea & Chocolate": [
    {
      name: "Hot Tea", station: "bar", variants: [
        ["Black", 1.75, { "Black Tea": 4, "Hot Cup 12oz": 1, "Cup Lid": 1 }],
        ["Green", 1.75, { "Green Tea": 4, "Hot Cup 12oz": 1, "Cup Lid": 1 }],
      ],
    },
    hot("Matcha Latte", 3.25, { "Matcha Powder": 4, [M]: 200 }),
    iced("Iced Matcha Latte", 3.5, { "Matcha Powder": 5, [M]: 220 }),
    hot("Chai Latte", 3, { "Chai Concentrate": 60, [M]: 150 }),
    hot("Hot Chocolate", 2.75, { "Cocoa Powder": 20, [M]: 200, "White Sugar": 10 }),
    iced("Thai Iced Tea", 2.5, { "Thai Tea Mix": 12, "Condensed Milk": 35 }, false),
    iced("Lime Iced Tea", 2.25, { "Black Tea": 4, Lime: 1, "Palm Sugar Syrup": 20 }, false),
    hot("Honey Lemon Tea", 2.5, { "Black Tea": 3, Honey: 20, Lemon: 1 }, false),
  ],
  "Smoothies & Juice": [
    iced("Mango Smoothie", 3.5, { Mango: 1, "Mango Puree": 40, Yogurt: 80 }, false),
    iced("Strawberry Smoothie", 3.5, { "Strawberry Puree": 80, Yogurt: 100 }, false),
    iced("Banana Oat Smoothie", 3.25, { Banana: 1, Oats: 30, [M]: 200, Honey: 10 }, false),
    iced("Avocado Smoothie", 3.75, { Avocado: 1, "Condensed Milk": 40, [M]: 150 }, false),
    iced("Passion Fruit Soda", 2.75, { "Passion Fruit Puree": 50, "Palm Sugar Syrup": 15, "Mint Leaves": 2 }, false),
    iced("Fresh Orange Juice", 3, { Orange: 3 }, false),
  ],
  Food: [
    simple("Butter Croissant", 2, { "Croissant (frozen)": 1, "Paper Bag": 1, Napkin: 1 }, "kitchen"),
    simple("Ham & Cheese Croissant", 3.25, { "Croissant (frozen)": 1, Ham: 40, "Cheddar Cheese": 30, "Paper Bag": 1, Napkin: 1 }, "kitchen"),
    simple("Ham & Cheese Toastie", 3.5, { "Bread Slice": 2, Ham: 50, "Cheddar Cheese": 40, Butter: 10, Napkin: 1 }, "kitchen"),
    simple("Yogurt Granola Cup", 3, { Yogurt: 150, Oats: 40, Honey: 15, Banana: 1 }, "kitchen"),
    simple("Banana Bread", 1.75, { "Banana Bread Slice": 1, Napkin: 1 }),
    simple("Chocolate Muffin", 2, { "Chocolate Muffin": 1, Napkin: 1 }),
    simple("Butter Cookie", 1, { "Butter Cookie": 1 }),
  ],
  Bottled: [
    simple("Bottled Water", 0.75, { "Bottled Water 500ml": 1 }),
    simple("Sparkling Water", 1.5, { "Sparkling Water": 1 }),
    simple("Cola", 1.25, { "Canned Cola": 1 }),
  ],
};
const CATEGORY_COLORS = ["#92400e", "#0369a1", "#15803d", "#c2410c", "#a16207", "#475569"];

// ---------- helpers ----------

/** Small seeded generator, so the demo data is the same on every run. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Move everything written "today" back `n` days (the café's local date).
 * Orders are spread over opening hours with a morning peak; their payments,
 * refunds and stock movements follow them. Append-only triggers are bypassed
 * (replica mode, needs a superuser connection) — seed only, never app code.
 */
async function backdate(tx: Executor, today: string, n: number) {
  const day = addDays(today, -n);
  const compact = (d: string) => d.replaceAll("-", "");
  const isToday = (col: string) => sql`(${sql.raw(col)} at time zone ${TZ})::date = ${today}::date`;
  const at = (time: string) => sql`((${day}::date + ${time}::time) at time zone ${TZ})`;
  await tx.execute(sql`set local session_replication_role = replica`);
  await tx.execute(sql`
    update orders o set created_at = t.ts, updated_at = t.ts,
      paid_at = case when o.paid_at is null then null else t.ts + interval '3 minutes' end,
      voided_at = case when o.voided_at is null then null else t.ts + interval '2 minutes' end,
      business_date = ${day}::date, order_no = replace(o.order_no, ${compact(today)}, ${compact(day)})
    from (
      select o2.id, ((${day}::date + time '06:30') + power((o2.queue_no - random()) / c.last_no, 1.3) * interval '12 hours') at time zone ${TZ} as ts
      from orders o2 join order_counters c on c.branch_id = o2.branch_id and c.business_date = o2.business_date
      where o2.business_date = ${today}::date
    ) t where o.id = t.id`);
  await tx.execute(sql`update order_counters set business_date = ${day}::date where business_date = ${today}::date`);
  // Old orders must not sit on the kitchen screen.
  await tx.execute(sql`
    update order_lines l set kitchen_status = 'served', kitchen_updated_at = o.paid_at + interval '5 minutes',
      sent_to_kitchen_at = case when l.sent_to_kitchen_at is null then null else o.paid_at end
    from orders o where o.id = l.order_id and o.business_date = ${day}::date`);
  await tx.execute(sql`update refunds r set created_at = o.paid_at + interval '1 minute' from orders o where o.id = r.order_id and ${isToday("r.created_at")}`);
  await tx.execute(sql`
    update payments p set created_at = o.paid_at + case when p.is_refund then interval '1 minute' else interval '0' end
    from orders o where o.id = p.order_id and ${isToday("p.created_at")}`);
  await tx.execute(sql`
    update stock_movements m set created_at = o.paid_at
    from order_lines l join orders o on o.id = l.order_id
    where m.ref_type = 'order_line' and m.ref_id = l.id::text and ${isToday("m.created_at")}`);
  await tx.execute(sql`
    update stock_movements m set created_at = r.created_at
    from refund_lines rl join refunds r on r.id = rl.refund_id
    where m.ref_type = 'refund_line' and m.ref_id = rl.id::text and ${isToday("m.created_at")}`);
  await tx.execute(sql`update shifts set opened_at = ${at("06:15")} where ${isToday("opened_at")}`);
  await tx.execute(sql`update shifts set closed_at = ${at("19:30")} where closed_at is not null and ${isToday("closed_at")}`);
  // Everything else still dated today (receipts, adjustments, audit log, master data created on the first day…).
  const cols = await tx.execute<{ table_name: string; column_name: string }>(sql`
    select c.table_name, c.column_name from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.data_type = 'timestamp with time zone'
      and c.table_name not in ('user', 'session', 'account', 'verification')`);
  for (const c of cols) {
    const col = sql.identifier(c.column_name);
    await tx.execute(sql`update ${sql.identifier(c.table_name)} set ${col} = ${col} - ${`${n} days`}::interval where (${col} at time zone ${TZ})::date = ${today}::date`);
  }
  await tx.execute(sql`set local session_replication_role = origin`);
}

export type DemoOptions = {
  /** Days of history before today (default 60). */
  days?: number;
  /** Password for every demo login. */
  password: string;
  /** Manager PIN for approvals (default 1234). */
  pin?: string;
};

/**
 * Fill a freshly seeded database (`seedDatabase` already run) with demo data.
 * Commits day by day; if it fails half-way, `pnpm db:reset` and run it again.
 */
export async function seedDemo(db: Executor, opts: DemoOptions): Promise<{ orders: number }> {
  // One transaction for the master data, then one per day: a single huge transaction with
  // tens of thousands of savepoints makes PostgreSQL crawl.
  let tx = db;
  let orderCount = 0;
  /** A context bound to the transaction currently in progress. */
  const c = (ctx: AppContext): AppContext => ({ ...ctx, db: tx });
  const days = opts.days ?? 60;
  const pin = opts.pin ?? "1234";
  const rand = rng(20261108);
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const chance = (p: number) => rand() < p;
  const today = todayLocal();

  const playDay = await db.transaction(async (setupTx) => {
  tx = setupTx;

  const [existing] = await tx.select({ id: products.id }).from(products).limit(1);
  if (existing) throw new Error("This database already has products. The demo seed only runs on a fresh database (pnpm db:reset first).");

  const [org] = await tx.select().from(organizations).limit(1);
  const [b1] = await tx.select().from(branches).where(eq(branches.orgId, org.id)).orderBy(asc(branches.createdAt)).limit(1);
  const [ownerRole] = await tx.select().from(roles).where(and(eq(roles.orgId, org.id), eq(roles.name, "Owner")));
  const [ownerRow] = await tx.select().from(userBranchRoles).where(and(eq(userBranchRoles.roleId, ownerRole.id), eq(userBranchRoles.branchId, b1.id))).limit(1);
  if (!ownerRow) throw new Error("No Owner found. Run pnpm db:seed first.");
  const ownerId = ownerRow.userId;
  const ctxFor = (userId: string, branchId: string) => buildContext(tx, { userId, requestedBranchId: branchId });

  // Second branch (the owner joins it with the Owner role), slightly dearer.
  const b2 = (await tx.select().from(branches).where(and(eq(branches.orgId, org.id), eq(branches.code, "B2"))))[0]
    ?? (await createBranch(await ctxFor(ownerId, b1.id), { code: "B2", name: "Riverside", address: "Sisowath Quay, Phnom Penh" }));
  const owner = await ctxFor(ownerId, b1.id);

  // Staff: a manager (with PIN), a cashier and a barista at each branch.
  const roleId = async (name: string) => (await tx.select().from(roles).where(and(eq(roles.orgId, org.id), eq(roles.name, name))))[0].id;
  const staff = async (branch: { id: string; code: string }, role: string, label: string, name: string) => {
    const email = `${label}.${branch.code.toLowerCase()}@demo.local`;
    const [found] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email));
    const id = found?.id ?? (await insertAuthUser(tx, { orgId: org.id, email, name, password: opts.password }));
    await tx.insert(userBranchRoles).values({ userId: id, branchId: branch.id, roleId: await roleId(role) }).onConflictDoNothing();
    return id;
  };

  // Inventory: categories, suppliers, 60 items.
  const supplierRows: { id: string }[] = [];
  for (const [name, paymentTermsDays] of SUPPLIERS) supplierRows.push(await createSupplier(owner, { name, paymentTermsDays }));
  type Item = { id: string; name: string; unitKey: string; factor: number; cost: number; supplier: number; resale: boolean };
  const item = new Map<string, Item>();
  for (const [category, rows] of Object.entries(ITEMS)) {
    const cat = await createCategory(owner, { name: category });
    for (const [name, base, unit, factor, cost, supplier, type] of rows) {
      const created = await createItem(owner, {
        name, categoryId: cat.id, baseUnitCode: base, itemType: type ?? "ingredient",
        units: [{ name: unit, factor: String(factor), isPurchaseDefault: true, isCountDefault: true }],
      });
      item.set(name, { id: created.id, name, unitKey: `iu:${created.units[0].id}`, factor, cost, supplier, resale: type === "resale" });
    }
  }
  const it = (name: string) => {
    const found = item.get(name);
    if (!found) throw new Error(`Demo recipe uses an unknown item: ${name}`);
    return found;
  };
  const recipe = (r: Recipe) => Object.entries(r).map(([name, qty]) => ({ itemId: it(name).id, unitKey: "base", qty: String(qty) }));

  // Menu: modifier groups, 40 products.
  const milkGroup = await saveModifierGroup(owner, null, {
    name: "Milk", minSelect: 0, maxSelect: 1,
    modifiers: [
      { name: "Oat milk", priceDelta: "0.75", recipe: recipe({ "Oat Milk": 180, [M]: -180 }) },
      { name: "Almond milk", priceDelta: "0.75", recipe: recipe({ "Almond Milk": 180, [M]: -180 }) },
      { name: "Soy milk", priceDelta: "0.50", recipe: recipe({ "Soy Milk": 180, [M]: -180 }) },
    ],
  });
  const extrasGroup = await saveModifierGroup(owner, null, {
    name: "Extras", minSelect: 0, maxSelect: 3,
    modifiers: [
      { name: "Extra shot", priceDelta: "0.75", recipe: recipe({ [B]: 18 }) },
      { name: "Vanilla syrup", priceDelta: "0.50", recipe: recipe({ "Vanilla Syrup": 20 }) },
      { name: "Caramel syrup", priceDelta: "0.50", recipe: recipe({ "Caramel Syrup": 20 }) },
      { name: "Whipped cream", priceDelta: "0.50", recipe: recipe({ "Whipping Cream": 30 }) },
      { name: "Less sugar", priceDelta: "0", recipe: [] },
    ],
  });
  const modIds = async (groupId: string) => (await tx.select({ id: modifiers.id }).from(modifiers).where(eq(modifiers.groupId, groupId))).map((m) => m.id);
  const milkMods = await modIds(milkGroup.id);
  const extraMods = await modIds(extrasGroup.id);

  type Sellable = { variantId: string; weight: number; milk: boolean; extras: boolean; resale: boolean };
  const sellables: Sellable[] = [];
  let rank = 0;
  for (const [i, [category, rows]] of Object.entries(MENU).entries()) {
    const cat = await createMenuCategory(owner, { name: category, color: CATEGORY_COLORS[i], sortOrder: i });
    for (const [j, p] of rows.entries()) {
      const product = await saveProduct(owner, null, {
        name: p.name, categoryId: cat.id, kitchenStation: p.station, sortOrder: j,
        modifierGroupIds: [...(p.milk ? [milkGroup.id] : []), ...(p.extras ? [extrasGroup.id] : [])],
        variants: p.variants.map(([name, price, r], k) => ({ name, price: price.toFixed(2), isDefault: k === 0, recipe: recipe(r) })),
      });
      const variants = await tx.select().from(productVariants).where(eq(productVariants.productId, product.id)).orderBy(asc(productVariants.sortOrder));
      // Earlier products in each list sell more.
      const weight = 1 / (1 + j * 0.35) / (1 + i * 0.25);
      for (const [k, v] of variants.entries()) {
        sellables.push({ variantId: v.id, weight: weight * (k === 0 ? 1 : 0.5), milk: !!p.milk, extras: !!p.extras, resale: p.station === "none" });
        // Riverside charges a little more for the first few drinks.
        if (rank < 6) await setBranchVariantPrice(owner, { branchId: b2.id, variantId: v.id, price: (Number(v.price) + 0.25).toFixed(2), isAvailable: true });
      }
      rank++;
    }
  }
  const totalWeight = sellables.reduce((a, s) => a + s.weight, 0);
  const pickSellable = () => {
    let r = rand() * totalWeight;
    for (const s of sellables) if ((r -= s.weight) <= 0) return s;
    return sellables[0];
  };

  // House accounts (AR).
  const customerIds: string[] = [];
  for (const [name, phone] of [["Sok Dara", "012 345 678"], ["Riverside Yoga Studio", "023 555 010"], ["Chan Sophea", "017 222 333"]]) {
    customerIds.push((await saveCustomer(owner, null, { name, phone, creditLimit: "150" })).id);
  }

  // Branch state.
  const PAR = 4; // purchase units kept on the shelf
  type BranchState = {
    branch: { id: string; code: string }; registerId: string; methods: Record<string, string>; managerId: string;
    ownerCtx: AppContext; managerCtx: AppContext; cashierCtx: AppContext; khrRate: string; busy: number;
  };
  const branchState: BranchState[] = [];
  for (const [i, b] of [b1, b2].entries()) {
    const manager = await staff(b, "Manager", "manager", i ? "Vanna (Manager)" : "Bopha (Manager)");
    const cashier = await staff(b, "Cashier", "cashier", i ? "Ratana" : "Pisey");
    await staff(b, "Barista/Kitchen", "barista", i ? "Sokha" : "Dara");
    const ownerHere = await ctxFor(ownerId, b.id);
    await setUserPin(ownerHere, manager, pin);
    for (const x of item.values()) {
      await setOpeningStock(ownerHere, { branchId: b.id, itemId: x.id, unitKey: x.unitKey, qty: String(PAR), unitCost: String(x.cost) });
      await setReorderLevel(ownerHere, { branchId: b.id, itemId: x.id, unitKey: x.unitKey, qty: "1" });
    }
    const [register] = await tx.select().from(registers).where(eq(registers.branchId, b.id)).limit(1);
    const methods = Object.fromEntries((await tx.select().from(paymentMethods).where(eq(paymentMethods.branchId, b.id))).map((m) => [m.type, m.id]));
    branchState.push({
      branch: b, registerId: register.id, methods, managerId: manager, ownerCtx: ownerHere,
      managerCtx: await ctxFor(manager, b.id), cashierCtx: await ctxFor(cashier, b.id),
      khrRate: (await currencyAt(tx, b.id, "KHR")).rate, busy: i ? 15 : 24,
    });
  }
  let invoiceNo = 1000;

  /** Top shelves back up to PAR: credit receipts per supplier, market items paid from the drawer. */
  async function restock(s: BranchState, date: string) {
    const levels = new Map((await tx.select().from(stockLevels).where(eq(stockLevels.branchId, s.branch.id))).map((l) => [l.itemId, Number(l.qtyOnHand)]));
    const bySupplier = new Map<number, { itemId: string; unitKey: string; qty: string; unitCost: string }[]>();
    for (const x of item.values()) {
      const units = (levels.get(x.id) ?? 0) / x.factor;
      if (units >= 2) continue;
      const line = { itemId: x.id, unitKey: x.unitKey, qty: String(Math.ceil(PAR - units)), unitCost: (x.cost * (0.97 + rand() * 0.09)).toFixed(2) };
      bySupplier.set(x.supplier, [...(bySupplier.get(x.supplier) ?? []), line]);
    }
    for (const [supplier, lines] of bySupplier) {
      if (supplier === MARKET) {
        await saveAndPostReceipt(c(s.managerCtx), null, { branchId: s.branch.id, purchaseType: "direct", supplierNameText: "Central Market", receiptDate: date, lines },
          { methodId: s.methods.cash, currencyCode: "USD", paidFromDrawer: { registerId: s.registerId } });
      } else {
        await saveAndPostReceipt(c(s.managerCtx), null, {
          branchId: s.branch.id, purchaseType: "credit", supplierId: supplierRows[supplier].id, supplierInvoiceNo: `INV-${invoiceNo++}`,
          receiptDate: date, paymentTermsDays: SUPPLIERS[supplier][1], lines,
          extraCosts: chance(0.3) ? [{ description: "Delivery", amount: "2.00" }] : [],
        });
      }
    }
  }

  /** Pay about 70% of what the branch owes each supplier (oldest invoices first). */
  async function paySuppliers(s: BranchState, date: string) {
    for (const sup of supplierRows) {
      const [{ due }] = await tx.select({ due: sql<string>`coalesce(sum(${goodsReceipts.amountDue}), 0)::text` }).from(goodsReceipts)
        .where(and(eq(goodsReceipts.branchId, s.branch.id), eq(goodsReceipts.supplierId, sup.id), eq(goodsReceipts.status, "posted")));
      const amount = dec(due).times(0.7).toDecimalPlaces(2);
      if (amount.lt(5)) continue;
      await recordSupplierPayment(c(s.managerCtx), {
        branchId: s.branch.id, supplierId: sup.id, paymentDate: date, amount: amount.toFixed(2),
        methodId: s.methods.bank_transfer, currencyCode: "USD", reference: `TRF-${invoiceNo++}`,
      });
    }
  }

  async function sell(s: BranchState, n: number) {
    const lines = Array.from({ length: chance(0.55) ? 1 : chance(0.7) ? 2 : 3 }, () => {
      const p = pickSellable();
      return {
        variantId: p.variantId, qty: chance(0.85) ? 1 : 2, discount: null,
        modifierIds: [...(p.milk && chance(0.18) ? [milkMods[int(0, milkMods.length - 1)]] : []), ...(p.extras && chance(0.2) ? [extraMods[int(0, extraMods.length - 1)]] : [])],
        resale: p.resale,
      };
    });
    const charge = chance(0.012); // house account, rung up by the manager
    const ctx = charge ? c(s.managerCtx) : c(s.cashierCtx);
    const order = await saveOrder(ctx, {
      branchId: s.branch.id, registerId: s.registerId, orderType: chance(0.4) ? "dine_in" : "takeaway",
      orderDiscount: chance(0.05) ? { type: "percent", value: "10", reason: "Promotion" } : null,
      lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty, discount: l.discount, modifierIds: l.modifierIds })),
    });
    orderCount++;
    const approval = { approverId: s.managerId, pin };
    if (chance(0.015)) {
      await voidOrder(c(s.managerCtx), order.id, { reason: "Customer changed their mind", approval });
      return;
    }
    const total = dec(order.total);
    const roll = rand();
    if (charge) {
      await payOrder(ctx, order.id, { registerId: s.registerId, tenders: [{ methodId: s.methods.account, currencyCode: "USD", amount: order.total }], customerId: customerIds[int(0, 2)] });
    } else if (roll < 0.5) {
      // Cash USD: the next round note up from the total.
      const tender = total.lte(5) && chance(0.5) ? total.toDecimalPlaces(0, 2 /* ROUND_CEIL */) : total.div(5).ceil().times(5);
      await payOrder(ctx, order.id, { registerId: s.registerId, tenders: [{ methodId: s.methods.cash, currencyCode: "USD", amount: tender.toFixed(2) }], changeCurrency: chance(0.6) ? "KHR" : "USD" });
    } else if (roll < 0.7) {
      const riel = total.times(s.khrRate).div(1000).ceil().times(1000);
      await payOrder(ctx, order.id, { registerId: s.registerId, tenders: [{ methodId: s.methods.cash, currencyCode: "KHR", amount: riel.toFixed(0) }], changeCurrency: "KHR" });
    } else {
      const methodId = roll < 0.93 ? s.methods.khqr : s.methods.card;
      await payOrder(ctx, order.id, { registerId: s.registerId, tenders: [{ methodId, currencyCode: "USD", amount: order.total, reference: `REF${100000 + orderCount}` }] });
    }
    if (!charge && n > 0 && chance(0.02)) {
      const [first] = await tx.select().from(orderLines).where(eq(orderLines.orderId, order.id)).orderBy(asc(orderLines.sortOrder)).limit(1);
      await refundOrder(c(s.managerCtx), order.id, {
        registerId: s.registerId, reason: lines[0].resale ? "Customer returned it unopened" : "Wrong drink made", approval,
        method: { methodId: s.methods.cash, currencyCode: "USD" }, lines: [{ orderLineId: first.id, qty: 1, restock: lines[0].resale }],
      });
    }
  }

  // ---------- play each day, oldest first ----------
  return async (n: number) => {
    // The services stamp rows with the current date; backdating only finds rows dated `today`.
    if (todayLocal() !== today) throw new Error("The date changed while seeding (it ran past midnight). Run pnpm db:reset and seed again.");
    const date = addDays(today, -n);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    for (const s of branchState) {
      const shift = await openShift(c(s.cashierCtx), {
        branchId: s.branch.id, registerId: s.registerId,
        floats: [{ currencyCode: "USD", amount: "100" }, { currencyCode: "KHR", amount: "200000" }],
      });
      await restock(s, date);
      if (n % 10 === 4) await paySuppliers(s, date);
      if (n % 7 === 5) {
        const adj = await createAdjustment(c(s.managerCtx), {
          branchId: s.branch.id, reasonCode: chance(0.5) ? "waste" : "expired", note: "End-of-week clear out",
          lines: [{ itemId: it(M).id, unitKey: "base", qty: String(-int(300, 900)) }, { itemId: it("Banana").id, unitKey: "base", qty: String(-int(1, 3)) }],
        });
        await postAdjustment(c(s.managerCtx), adj.id);
      }
      if (n === 30) {
        // Month-end count of beans: a little less on the shelf than the system says.
        const [level] = await tx.select().from(stockLevels).where(and(eq(stockLevels.branchId, s.branch.id), eq(stockLevels.itemId, it(B).id)));
        const count = await createCount(c(s.managerCtx), { branchId: s.branch.id, note: "Month-end count" });
        await saveCountLines(c(s.managerCtx), count.id, [{ itemId: it(B).id, unitKey: "base", qty: String(Math.max(0, Math.round(Number(level.qtyOnHand)) - 120)) }]);
        await postCount(c(s.managerCtx), count.id);
      }
      if (n === 20 && s.branch.id === b1.id) {
        const t = await createTransfer(c(owner), { fromBranchId: b1.id, toBranchId: b2.id, note: "Riverside ran low", lines: [{ itemId: it("Oat Milk").id, unitKey: "base", qty: "2000" }] }, { send: true });
        const tl = await tx.select().from(stockTransferLines).where(eq(stockTransferLines.transferId, t.id));
        await receiveTransfer(c(branchState[1].ownerCtx), t.id, { lines: tl.map((l) => ({ lineId: l.id, qtyReceived: l.qtySent })) });
      }
      if (n % 14 === 2) {
        await recordCustomerPayment(c(s.managerCtx), {
          customerId: customerIds[int(0, 2)], branchId: s.branch.id, registerId: s.registerId,
          methodId: s.methods.cash, currencyCode: "USD", amount: "15", paymentDate: date,
        });
      }

      const weekend = weekday === 0 || weekday === 6;
      const target = n === 0 ? 6 : Math.round(s.busy * (weekend ? 1.3 : 1) * (0.8 + rand() * 0.4));
      for (let i = 0; i < target; i++) await sell(s, n);

      if (n > 0) {
        // Count the drawer: usually exact, sometimes a few cents off (under the PIN threshold).
        const counted = (await expectedCash(tx, shift.id)).map((c) => ({
          currencyCode: c.currencyCode,
          amount: c.currencyCode === "USD" && chance(0.15) ? dec(c.expected).minus(0.25).toFixed(2) : c.expected,
        }));
        await closeShift(c(s.cashierCtx), shift.id, { counted });
      }
    }
  };
  });

  for (let n = days; n >= 0; n--) {
    await db.transaction(async (dayTx) => {
      tx = dayTx;
      await playDay(n);
      if (n > 0) return backdate(dayTx, today, n);
      // Today's orders: only the last two per branch are still waiting in the kitchen.
      await dayTx.execute(sql`
        update order_lines l set kitchen_status = 'served', kitchen_updated_at = now()
        from orders o join order_counters c on c.branch_id = o.branch_id and c.business_date = o.business_date
        where o.id = l.order_id and o.business_date = ${today}::date and o.queue_no <= c.last_no - 2`);
    });
  }
  return { orders: orderCount };
}
