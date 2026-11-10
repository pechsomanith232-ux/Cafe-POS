import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { branches, paymentMethods, refundLines, registers, rolePermissions, roles, stockMovements, userBranchRoles } from "@/db/schema";
import { addDays, todayLocal } from "@/lib/dates";
import { ValidationError } from "@/lib/errors";
import { ForbiddenError } from "@/lib/permissions";
import { getOrder, getPosMenu } from "@/lib/queries/pos";
import { apAging } from "@/lib/queries/purchasing";
import { customerStatement } from "@/lib/queries/reports/ar";
import { dashboard } from "@/lib/queries/reports/dashboard";
import { reorderReport, stockValuation, usageVariance, wasteReport } from "@/lib/queries/reports/inventory";
import { shiftList, voidRefundLog } from "@/lib/queries/reports/logs";
import { profitReport } from "@/lib/queries/reports/profit";
import { apAgingReport, directPurchases, supplierStatementReport } from "@/lib/queries/reports/purchasing";
import { branchComparison, salesByItem, salesByPayment, salesByStaff, salesSummary } from "@/lib/queries/reports/sales";
import { resolveScope } from "@/lib/queries/reports/scope";
import { saveCustomer, recordCustomerPayment } from "@/lib/services/customers";
import { createAdjustment, createCount, postAdjustment, postCount, saveCountLines, setOpeningStock, setReorderLevel } from "@/lib/services/inventory";
import { saveProduct } from "@/lib/services/menu";
import { saveOrder, type SaveOrderInput } from "@/lib/services/orders";
import { payOrder, refundOrder, voidOrder } from "@/lib/services/payments";
import { createSupplier, postGoodsReceipt, recordSupplierPayment, saveAndPostReceipt, saveReceipt } from "@/lib/services/purchasing";
import { openShift } from "@/lib/services/shifts";
import { setUserPin } from "@/lib/services/users";
import { closeTestDb, withRollback, type TestTx } from "./helpers/db";
import { createItem, createWorld } from "./helpers/fixtures";

afterAll(closeTestDb);

const TODAY = todayLocal();
const D = (n: number) => addDays(TODAY, -n);

/**
 * Move every row created "today" back n days. Rows already moved are no longer
 * today, so calling this after each day's work builds a history day by day.
 * Append-only triggers are bypassed (replica mode) — test-only.
 */
async function moveToday(tx: TestTx, n: number) {
  const iv = sql.raw(`interval '${n} days'`);
  const today = sql`(now() at time zone 'Asia/Phnom_Penh')::date`;
  const isToday = (col: string) => sql`(${sql.raw(col)} at time zone 'Asia/Phnom_Penh')::date = ${today}`;
  await tx.execute(sql`set local session_replication_role = replica`);
  await tx.execute(sql`update orders set paid_at = paid_at - ${iv} where paid_at is not null and ${isToday("paid_at")}`);
  await tx.execute(sql`update orders set voided_at = voided_at - ${iv} where voided_at is not null and ${isToday("voided_at")}`);
  await tx.execute(sql`update orders set created_at = created_at - ${iv}, business_date = business_date - ${sql.raw(String(n))} where ${isToday("created_at")}`);
  for (const t of ["payments", "refunds", "stock_movements", "cash_movements", "audit_log", "customer_payments"]) {
    await tx.execute(sql`update ${sql.raw(t)} set created_at = created_at - ${iv} where ${isToday("created_at")}`);
  }
  await tx.execute(sql`update stock_counts set posted_at = posted_at - ${iv} where posted_at is not null and ${isToday("posted_at")}`);
  await tx.execute(sql`update stock_adjustments set posted_at = posted_at - ${iv} where posted_at is not null and ${isToday("posted_at")}`);
  await tx.execute(sql`set local session_replication_role = origin`);
}

async function setup(tx: TestTx) {
  const w = await createWorld(tx);
  const owner = await w.ctxFor(w.users.owner);
  await tx.update(branches).set({ taxRate: "0" }).where(eq(branches.id, w.b1.id));
  const [reg] = await tx.select().from(registers).where(eq(registers.branchId, w.b1.id));
  const mk = async (name: string, base: "g" | "ml" | "pcs", qty: string, cost: string) => {
    const it = await createItem(tx, w.org.id, { name, base });
    await setOpeningStock(owner, { branchId: w.b1.id, itemId: it.id, unitKey: "base", qty, unitCost: cost });
    return it;
  };
  const beans = await mk("Beans", "g", "1000", "0.025");
  const milk = await mk("Milk", "ml", "10000", "0.0015");
  const tea = await mk("Tea leaves", "g", "500", "0.05");
  const water = await mk("Water bottle", "pcs", "24", "0.30");
  const r = (itemId: string, qty: string) => ({ itemId, unitKey: "base", qty });
  await saveProduct(owner, null, { name: "Latte", kitchenStation: "bar", deductStock: true, modifierGroupIds: [], variants: [
    { name: "Regular", price: "2.80", deductStock: null, isDefault: true, recipe: [r(beans.id, "18"), r(milk.id, "200")] },
  ] });
  await saveProduct(owner, null, { name: "Tea", kitchenStation: "bar", deductStock: false, modifierGroupIds: [], variants: [
    { name: "Cup", price: "1.50", deductStock: null, isDefault: true, recipe: [r(tea.id, "5")] },
  ] });
  await saveProduct(owner, null, { name: "Water", kitchenStation: "none", deductStock: true, modifierGroupIds: [], variants: [{ name: "Bottle", price: "0.75", deductStock: null, isDefault: true, recipe: [r(water.id, "1")] }] });
  await saveProduct(owner, null, { name: "Cookie", kitchenStation: "kitchen", deductStock: true, modifierGroupIds: [], variants: [{ name: "Each", price: "1.00", deductStock: null, isDefault: true, recipe: [] }] });
  const menu = await getPosMenu(owner);
  const v = (p: string) => menu.products.find((x) => x.name === p)!.variants[0].id;
  const methods = Object.fromEntries((await tx.select().from(paymentMethods).where(eq(paymentMethods.branchId, w.b1.id))).map((m) => [m.type, m.id]));
  await setUserPin(owner, w.users.manager, "4321");
  const shift = await openShift(owner, { branchId: w.b1.id, registerId: reg.id, floats: [{ currencyCode: "USD", amount: "50" }, { currencyCode: "KHR", amount: "100000" }] });
  const order = (lines: SaveOrderInput["lines"]) => saveOrder(owner, { branchId: w.b1.id, registerId: reg.id, orderType: "takeaway", orderDiscount: null, lines });
  const cash = (currencyCode: string, amount: string) => ({ methodId: methods.cash, currencyCode, amount });
  const approval = { approverId: w.users.manager, pin: "4321" };
  return { ...w, tx, owner, reg, shift, beans, milk, tea, water, v, methods, order, cash, approval };
}
type W = Awaited<ReturnType<typeof setup>>;
const line = (variantId: string, qty = 1, discount: { type: "amount" | "percent"; value: string } | null = null) => ({ variantId, qty, modifierIds: [], discount });

/**
 * A seeded week at B1 (tax 0):
 *  D-10 (outside range): Cookie ×1 — $1.00
 *  D-3: A = Latte ×2 ($5.60, cash USD)
 *       B = Water ×1 + Cookie ×1 less $0.25 + Tea ×1 ($3.00, cash USD)
 *  D-2: C = Water ×3 ($2.25, paid 10,000 riel); waste 100 g beans
 *  D-1: refund 1 Water from C (restocked, $0.75 cash USD); order E voided;
 *       count milk at 9,000 ml (expected 9,600)
 */
async function seedWeek(w: W) {
  const pay = async (o: { id: string }, tenders: ReturnType<W["cash"]>[], changeCurrency = "USD") =>
    payOrder(w.owner, o.id, { registerId: w.reg.id, tenders, changeCurrency });
  await pay(await w.order([line(w.v("Cookie"))]), [w.cash("USD", "1")]);
  await moveToday(w.tx, 10);

  const A = await w.order([line(w.v("Latte"), 2)]);
  await pay(A, [w.cash("USD", "5.60")]);
  const B = await w.order([line(w.v("Water")), line(w.v("Cookie"), 1, { type: "amount", value: "0.25" }), line(w.v("Tea"))]);
  await pay(B, [w.cash("USD", "3")]);
  await moveToday(w.tx, 3);

  const C = await w.order([line(w.v("Water"), 3)]);
  const payC = await pay(C, [w.cash("KHR", "10000")], "KHR");
  const adj = await createAdjustment(w.owner, { branchId: w.b1.id, reasonCode: "waste", note: "Spilled", lines: [{ itemId: w.beans.id, unitKey: "base", qty: "-100" }] });
  await postAdjustment(w.owner, adj.id);
  await moveToday(w.tx, 2);

  const cLine = (await getOrder(w.owner, C.id)).lines[0];
  await refundOrder(w.owner, C.id, { registerId: w.reg.id, reason: "Bottle leaked", approval: w.approval, method: { methodId: w.methods.cash, currencyCode: "USD" }, lines: [{ orderLineId: cLine.id, qty: 1, restock: true }] });
  const E = await w.order([line(w.v("Latte"))]);
  await voidOrder(w.owner, E.id, { reason: "Customer left", approval: w.approval });
  const count = await createCount(w.owner, { branchId: w.b1.id });
  await saveCountLines(w.owner, count.id, [{ itemId: w.milk.id, unitKey: "base", qty: "9000" }, { itemId: w.water.id, unitKey: "base", qty: "21" }]);
  await postCount(w.owner, count.id);
  await moveToday(w.tx, 1);
  return { A, B, C, E, payC };
}

const WEEK = (branch: string) => ({ branch, from: D(7), to: D(1) });

describe("report scope", () => {
  it("needs the report permission at the branch; 'all' needs reports.all_branches", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const cashier = await w.ctxFor(w.users.cashier);
      const manager = await w.ctxFor(w.users.manager);
      await tx.insert(userBranchRoles).values({ userId: w.users.owner, branchId: w.b2.id, roleId: w.roleIds.owner });
      const owner = await w.ctxFor(w.users.owner);
      expect(() => resolveScope(cashier, "reports.sales", w.b1.id)).toThrow(ForbiddenError);
      expect(resolveScope(manager, "reports.sales", w.b1.id).branchIds).toEqual([w.b1.id]);
      expect(() => resolveScope(manager, "reports.sales", w.b2.id)).toThrow(ForbiddenError);
      expect(() => resolveScope(manager, "reports.sales", "all")).toThrow(ForbiddenError);
      expect(resolveScope(owner, "reports.sales", "all").branchIds.sort()).toEqual([w.b1.id, w.b2.id].sort());
    });
  });
});

describe("Phase 7 acceptance: a seeded week", () => {
  it("profit report (net sales − COGS) reconciles with the movement ledger", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await seedWeek(w);
      const p = await profitReport(w.owner, WEEK(w.b1.id));
      // Ledger, computed independently: sale movements minus restocked refunds, by movement date.
      const [ledger] = await tx.execute<{ cogs: string }>(sql`
        select (-coalesce(sum(total_cost), 0))::numeric(18,4)::text as cogs from stock_movements
        where branch_id = ${w.b1.id} and movement_type in ('sale', 'refund_restock')
          and (created_at at time zone 'Asia/Phnom_Penh')::date between ${D(7)} and ${D(1)}`);
      expect(ledger.cogs).toBe("2.4000");
      expect(p.totals).toMatchObject({ netSales: "10.1000", cogs: "2.4000", grossProfit: "7.7000", theoreticalCost: "0.2500" });
      expect(p.totals.marginPct).toBe("76.24");
      const by = Object.fromEntries(p.byProduct.map((r) => [r.label, [r.netSales, r.cogs, r.grossProfit]]));
      expect(by).toEqual({
        Latte: ["5.6000", "1.5000", "4.1000"],
        Water: ["2.2500", "0.9000", "1.3500"],
        Tea: ["1.5000", "0.0000", "1.5000"],
        Cookie: ["0.7500", "0.0000", "0.7500"],
      });
      // Products and categories each add up to the ledger total.
      const sum = (rows: { cogs: string }[]) => rows.reduce((a, r) => a + Number(r.cogs), 0).toFixed(4);
      expect(sum(p.byProduct)).toBe("2.4000");
      expect(sum(p.byCategory)).toBe("2.4000");
      expect(p.costSources).toEqual(expect.arrayContaining([expect.objectContaining({ source: "theoretical", cost: "0.2500" })]));
    });
  });

  it("sales summary: gross, discounts, refunds, net, orders, average ticket, by day and hour", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await seedWeek(w);
      const s = await salesSummary(w.owner, WEEK(w.b1.id));
      expect(s.totals).toMatchObject({
        orders: 3, grossSales: "11.1000", discounts: "0.2500", tax: "0.0000", netSales: "10.8500", totalSales: "10.8500",
        refunds: "0.7500", refundsExTax: "0.7500", netAfterRefunds: "10.1000", avgTicket: "3.6167",
      });
      expect(s.byDay.map((d) => [d.date, d.orders, d.netSales, d.refunds])).toEqual([
        [D(3), 2, "8.6000", "0.0000"],
        [D(2), 1, "2.2500", "0.0000"],
        [D(1), 0, "0.0000", "0.7500"],
      ]);
      expect(s.byHour.reduce((a, h) => a + h.orders, 0)).toBe(3);
      // The day outside the range is excluded; widening the range includes it.
      const wide = await salesSummary(w.owner, { branch: w.b1.id, from: D(30), to: TODAY });
      expect(wide.totals.orders).toBe(4);
    });
  });

  it("sales by product / category / variant / modifier add up to net sales", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await seedWeek(w);
      const rows = await salesByItem(w.owner, { ...WEEK(w.b1.id), by: "product" });
      expect(rows.map((r) => [r.label, r.qty, r.netSales])).toEqual([
        ["Latte", 2, "5.6000"], ["Water", 3, "2.2500"], ["Tea", 1, "1.5000"], ["Cookie", 1, "0.7500"],
      ]);
      expect(rows[0].pct).toBe("55.45");
      const variants = await salesByItem(w.owner, { ...WEEK(w.b1.id), by: "variant" });
      expect(variants.find((r) => r.label === "Latte · Regular")?.qty).toBe(2);
      const cats = await salesByItem(w.owner, { ...WEEK(w.b1.id), by: "category" });
      expect(cats.reduce((a, r) => a + Number(r.netSales), 0).toFixed(4)).toBe("10.1000");
      expect(await salesByItem(w.owner, { ...WEEK(w.b1.id), by: "modifier" })).toEqual([]);
    });
  });

  it("payments by method and currency: KHR vs USD cash collected", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const { payC } = await seedWeek(w);
      const p = await salesByPayment(w.owner, WEEK(w.b1.id));
      const usd = p.cash.find((c) => c.currency === "USD")!;
      const khr = p.cash.find((c) => c.currency === "KHR")!;
      expect(usd).toMatchObject({ received: "8.6000", change: "0.0000", refunded: "0.7500", net: "7.8500" });
      expect(payC.change.currency).toBe("KHR");
      expect(khr.received).toBe("10000.0000");
      expect(Number(khr.net)).toBe(10000 - Number(payC.change.amount));
      expect(p.methods.find((m) => m.currency === "KHR")?.count).toBe(1);
    });
  });

  it("sales by staff, with voids and refunds; the void & refund log names the approver", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await seedWeek(w);
      const staff = await salesByStaff(w.owner, WEEK(w.b1.id));
      expect(staff).toHaveLength(1);
      expect(staff[0]).toMatchObject({ orders: 3, netSales: "10.8500", voids: 1, voidTotal: "2.8000", refunds: 1, refundTotal: "0.7500" });
      const log = await voidRefundLog(w.owner, WEEK(w.b1.id));
      expect(log.map((l) => [l.kind, l.amount, l.reason, l.approvedByName])).toEqual([
        ["refund", "0.7500", "Bottle leaked", "manager"],
        ["void", "2.8000", "Customer left", "manager"],
      ]);
    });
  });

  it("waste & adjustments by reason; theoretical vs actual usage", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await seedWeek(w);
      const waste = await wasteReport(w.owner, WEEK(w.b1.id));
      expect(waste.byReason).toEqual([{ reason: "waste", lines: 1, value: "2.5000" }]);
      expect(waste.rows[0]).toMatchObject({ item: "Beans", qty: "-100.0000", value: "-2.5000", note: "Spilled" });

      const u = await usageVariance(w.owner, WEEK(w.b1.id));
      const milk = u.find((r) => r.item === "Milk")!;
      expect(milk).toMatchObject({ recorded: "400.0000", estimated: "0.0000", adjustments: "0.0000", countVariance: "-600.0000", actual: "1000.0000", variance: "600.0000", varianceValue: "0.9000" });
      const beans = u.find((r) => r.item === "Beans")!;
      // Beans were never counted: actual is known usage, but variance can't be measured.
      expect(beans).toMatchObject({ recorded: "36.0000", adjustments: "100.0000", actual: "136.0000", variance: null, varianceValue: null });
      // Tea doesn't deduct stock: its expected usage comes from the current recipe.
      expect(u.find((r) => r.item === "Tea leaves")).toMatchObject({ recorded: "0.0000", estimated: "5.0000", actual: "0.0000", variance: null });
      const water = u.find((r) => r.item === "Water bottle")!;
      // Counted exactly right (no movement written): variance is a measured zero.
      expect(water).toMatchObject({ recorded: "3.0000", actual: "3.0000", variance: "0.0000" });
    });
  });

  it("stock valuation as of a date; low stock with a suggested reorder", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`update stock_movements set created_at = created_at - interval '20 days'`);
      await tx.execute(sql`set local session_replication_role = origin`);
      await seedWeek(w);
      const before = await stockValuation(w.owner, { branch: w.b1.id, asOf: D(5), unit: "base" });
      expect(before.rows.find((r) => r.item === "Water bottle")).toMatchObject({ qty: "24.0000", value: "7.2000" });
      const now = await stockValuation(w.owner, { branch: w.b1.id, asOf: TODAY, unit: "base" });
      expect(now.rows.find((r) => r.item === "Water bottle")).toMatchObject({ qty: "21.0000", avgCost: "0.300000", value: "6.3000" });
      expect(now.total).toBe(now.rows.reduce((a, r) => a + Number(r.value), 0).toFixed(4));

      await setReorderLevel(w.owner, { branchId: w.b1.id, itemId: w.water.id, unitKey: "base", qty: "30" });
      const low = await reorderReport(w.owner, { branch: w.b1.id });
      expect(low.find((r) => r.item === "Water bottle")).toMatchObject({ onHand: "21.0000", reorderLevel: "30.0000", suggested: "39.0000", suggestedValue: "11.7000", lastSupplier: null });
    });
  });
});

describe("other reports", () => {
  it("customer statement: opening balance, charges, payments, running balance", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const c = await saveCustomer(w.owner, null, { name: "Sok", creditLimit: "50" });
      const o = await w.order([line(w.v("Latte"))]);
      await payOrder(w.owner, o.id, { registerId: w.reg.id, tenders: [{ methodId: w.methods.account, currencyCode: "USD", amount: "2.80" }], changeCurrency: "USD", customerId: c.id });
      await moveToday(tx, 5);
      await recordCustomerPayment(w.owner, { customerId: c.id, branchId: w.b1.id, registerId: w.reg.id, methodId: w.methods.cash, currencyCode: "USD", amount: "1" });
      const st = await customerStatement(w.owner, { customerId: c.id, from: D(7), to: TODAY });
      expect(st.opening).toBe("0.0000");
      expect(st.rows.map((r) => [r.kind, r.debit, r.credit, r.balance])).toEqual([["charge", "2.8000", null, "2.8000"], ["payment", null, "1.0000", "1.8000"]]);
      expect(st.closing).toBe("1.8000");
      const later = await customerStatement(w.owner, { customerId: c.id, from: D(2), to: TODAY });
      expect(later.opening).toBe("2.8000");
      expect(later.rows).toHaveLength(1);
    });
  });

  it("direct purchases list the payment method and whether it came from the drawer", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const r = await saveReceipt(w.owner, null, { branchId: w.b1.id, purchaseType: "direct", supplierNameText: "Central Market", receiptDate: D(2), lines: [{ itemId: w.milk.id, unitKey: "base", qty: "2000", unitCost: "0.002" }], extraCosts: [] });
      await postGoodsReceipt(w.owner, r.id, { methodId: w.methods.cash, currencyCode: "USD", paidFromDrawer: { registerId: w.reg.id } });
      const rows = await directPurchases(w.owner, WEEK(w.b1.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ supplier: "Central Market", total: "4.0000", method: "Cash", currency: "USD", paidFromDrawer: true });
      expect(await directPurchases(w.owner, { branch: w.b1.id, from: D(1), to: TODAY })).toHaveLength(0);
    });
  });

  it("supplier statement for a period carries an opening balance; shift list links shifts", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const sup = await createSupplier(w.owner, { name: "Dairy Co", paymentTermsDays: 30 });
      await saveAndPostReceipt(w.owner, null, { branchId: w.b1.id, purchaseType: "credit", supplierId: sup.id, supplierInvoiceNo: "INV-1", receiptDate: D(10), lines: [{ itemId: w.milk.id, unitKey: "base", qty: "1000", unitCost: "0.002" }], extraCosts: [] });
      await recordSupplierPayment(w.owner, { branchId: w.b1.id, supplierId: sup.id, paymentDate: D(3), methodId: w.methods.cash, currencyCode: "USD", amount: "0.5" });
      const st = await supplierStatementReport(w.owner, { supplierId: sup.id, branchId: w.b1.id, from: D(7), to: TODAY });
      expect(st.opening).toBe("2.0000");
      expect(st.rows.map((r) => [r.kind, r.credit, r.balance])).toEqual([["payment", "0.5000", "1.5000"]]);
      expect(st.closing).toBe("1.5000");
      // AP aging drills down to the open invoices behind each supplier's buckets.
      const aging = await apAging(w.owner, { branchId: w.b1.id, asOf: TODAY });
      expect(aging.rows[0].invoices).toMatchObject([{ invoiceNo: "INV-1", amountDue: "1.5000", receiptDate: D(10) }]);
      const shifts = await shiftList(w.owner, { branch: w.b1.id, from: TODAY, to: TODAY });
      expect(shifts).toMatchObject([{ id: w.shift.id, status: "open", orders: 0 }]);
    });
  });

  it("dashboard: today's sales, orders, average ticket, top products, open shifts, 7/30-day series", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await seedWeek(w);
      const o = await w.order([line(w.v("Latte")), line(w.v("Water"))]);
      await payOrder(w.owner, o.id, { registerId: w.reg.id, tenders: [w.cash("USD", "3.55")], changeCurrency: "USD" });
      const d = await dashboard(w.owner, w.b1.id);
      expect(d.today).toMatchObject({ orders: 1, netSales: "3.5500", avgTicket: "3.5500" });
      expect(d.topProducts[0]).toMatchObject({ label: "Latte", qty: 1 });
      expect(d.openShifts).toHaveLength(1);
      expect(d.series30).toHaveLength(30);
      expect(d.series30.at(-1)).toMatchObject({ date: TODAY, netSales: "3.5500" });
      expect(d.series30.find((x) => x.date === D(3))?.netSales).toBe("8.6000");
      expect(d.series30.find((x) => x.date === D(1))?.netSales).toBe("-0.7500");
    });
  });

  it("refuses a branch the user can't see", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const b2 = await w.ctxFor(w.users.b2user);
      await expect(salesSummary(b2, WEEK(w.b1.id))).rejects.toThrow(ForbiddenError);
      await expect(profitReport(await w.ctxFor(w.users.cashier), WEEK(w.b1.id))).rejects.toThrow(ForbiddenError);
    });
  });
});

describe("migration 0015", () => {
  it("re-points legacy refund restock movements (ref_type 'refund') at their refund line", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      const o = await w.order([line(w.v("Water"), 2), line(w.v("Latte"))]);
      await payOrder(w.owner, o.id, { registerId: w.reg.id, tenders: [w.cash("USD", "5")], changeCurrency: "USD" });
      const water = (await getOrder(w.owner, o.id)).lines.find((l) => l.productName === "Water")!;
      const r = await refundOrder(w.owner, o.id, { registerId: w.reg.id, reason: "x", approval: w.approval, method: { methodId: w.methods.cash, currencyCode: "USD" }, lines: [{ orderLineId: water.id, qty: 1, restock: true }] });
      const [rl] = await tx.select().from(refundLines).where(eq(refundLines.refundId, r.refundId));
      // Make it look like data written before Phase 7.
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`update stock_movements set ref_type = 'refund', ref_id = ${r.refundId} where ref_type = 'refund_line' and ref_id = ${rl.id}`);
      await tx.execute(sql`set local session_replication_role = origin`);
      await tx.execute(sql.raw(readFileSync("drizzle/0015_refund_line_refs.sql", "utf8").replaceAll("--> statement-breakpoint", "")));
      const back = await tx.select().from(stockMovements).where(and(eq(stockMovements.refType, "refund_line"), eq(stockMovements.refId, rl.id)));
      expect(back.map((m) => [m.movementType, m.itemId, m.qtyBase])).toEqual([["refund_restock", w.water.id, "1.0000"]]);
      const p = await profitReport(w.owner, { branch: w.b1.id, from: TODAY, to: TODAY });
      expect(p.totals.cogs).toBe("1.0500"); // latte 0.75 + one water 0.30
    });
  });
});

describe("review fixes", () => {
  it("a calendar-invalid date is a validation error, not a crash", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await expect(salesSummary(w.owner, { branch: w.b1.id, from: "2026-02-30", to: TODAY })).rejects.toThrow(ValidationError);
    });
  });

  it("tax-inclusive sale with a partial refund without restock: refunds ex tax reconcile, COGS stays", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await tx.update(branches).set({ taxRate: "10", taxInclusive: true }).where(eq(branches.id, w.b1.id));
      const o = await w.order([line(w.v("Water"), 2)]); // $1.50 incl. tax
      await payOrder(w.owner, o.id, { registerId: w.reg.id, tenders: [w.cash("USD", "1.50")], changeCurrency: "USD" });
      const l = (await getOrder(w.owner, o.id)).lines[0];
      await refundOrder(w.owner, o.id, { registerId: w.reg.id, reason: "x", approval: w.approval, method: { methodId: w.methods.cash, currencyCode: "USD" }, lines: [{ orderLineId: l.id, qty: 1, restock: false }] });
      const s = await salesSummary(w.owner, { branch: w.b1.id, from: TODAY, to: TODAY });
      expect(s.totals).toMatchObject({ totalSales: "1.5000", tax: "0.1400", netSales: "1.3600", refunds: "0.7500", refundsExTax: "0.6800", netAfterRefunds: "0.6800" });
      const p = await profitReport(w.owner, { branch: w.b1.id, from: TODAY, to: TODAY });
      expect(p.totals).toMatchObject({ netSales: "0.6800", cogs: "0.6000" }); // both bottles are gone
    });
  });

  it("'all' branches sums every branch the user may report on", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await tx.insert(userBranchRoles).values({ userId: w.users.owner, branchId: w.b2.id, roleId: w.roleIds.owner });
      const owner = await w.ctxFor(w.users.owner);
      const o = await w.order([line(w.v("Latte"))]);
      await payOrder(w.owner, o.id, { registerId: w.reg.id, tenders: [w.cash("USD", "2.80")], changeCurrency: "USD" });
      const all = await salesSummary(owner, { branch: "all", from: TODAY, to: TODAY });
      const b2 = await salesSummary(owner, { branch: w.b2.id, from: TODAY, to: TODAY });
      expect(all.totals.netSales).toBe("2.8000");
      expect(b2.totals.orders).toBe(0);
    });
  });
});

describe("Phase 8: all-branches mode", () => {
  it("branch comparison: one row per branch with sales and profit; needs reports.all_branches", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await tx.insert(userBranchRoles).values({ userId: w.users.owner, branchId: w.b2.id, roleId: w.roleIds.owner });
      const owner = await w.ctxFor(w.users.owner);
      const o = await w.order([line(w.v("Latte"), 2)]);
      await payOrder(w.owner, o.id, { registerId: w.reg.id, tenders: [w.cash("USD", "5.60")], changeCurrency: "USD" });
      const rows = await branchComparison(owner, { branch: "all", from: TODAY, to: TODAY });
      expect(rows.map((r) => [r.branch, r.orders, r.netSales, r.cogs, r.grossProfit])).toEqual([
        [w.b1.name, 1, "5.6000", "1.5000", "4.1000"],
        [w.b2.name, 0, "0.0000", "0.0000", "0.0000"],
      ]);
      await expect(branchComparison(await w.ctxFor(w.users.manager), { branch: "all", from: TODAY, to: TODAY })).rejects.toThrow(ForbiddenError);
      // A role with profit but not sales reports at B2: B2 is left out instead of crashing.
      const [r] = await tx.insert(roles).values({ orgId: w.org.id, name: "Profit only" }).returning();
      await tx.insert(rolePermissions).values(["reports.profit", "reports.all_branches"].map((k) => ({ roleId: r.id, permissionKey: k })));
      await tx.update(userBranchRoles).set({ roleId: r.id }).where(and(eq(userBranchRoles.userId, w.users.owner), eq(userBranchRoles.branchId, w.b2.id)));
      expect((await branchComparison(await w.ctxFor(w.users.owner), { branch: "all", from: TODAY, to: TODAY })).map((x) => x.branch)).toEqual([w.b1.name]);
    });
  });

  it("AP aging across branches adds each supplier's branches together", async () => {
    await withRollback(async (tx) => {
      const w = await setup(tx);
      await tx.insert(userBranchRoles).values({ userId: w.users.owner, branchId: w.b2.id, roleId: w.roleIds.owner });
      const atB1 = await w.ctxFor(w.users.owner, w.b1.id);
      const atB2 = await w.ctxFor(w.users.owner, w.b2.id);
      const sup = await createSupplier(atB1, { name: "Dairy Co", paymentTermsDays: 30 });
      for (const [ctx, b] of [[atB1, w.b1.id], [atB2, w.b2.id]] as const) {
        await saveAndPostReceipt(ctx, null, { branchId: b, purchaseType: "credit", supplierId: sup.id, supplierInvoiceNo: `INV-${b.slice(0, 4)}`, receiptDate: TODAY, lines: [{ itemId: w.milk.id, unitKey: "base", qty: "1000", unitCost: "0.002" }], extraCosts: [] });
      }
      const all = await apAgingReport(atB1, { branch: "all", asOf: TODAY });
      expect(all.rows).toHaveLength(1);
      expect(all.rows[0]).toMatchObject({ supplierName: "Dairy Co", total: "4.0000" });
      expect(all.rows[0].invoices).toHaveLength(2);
      expect(all.totals.total).toBe("4.0000");
    });
  });
});
