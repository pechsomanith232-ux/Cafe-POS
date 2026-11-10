// Plan Phase 9: every default role can only do what the role matrix allows.
// Server actions are called directly with the context of a user in that role;
// each attempt runs in a savepoint that is rolled back, so attempts don't
// affect each other.
import { TransactionRollbackError, and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const current = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/context", () => ({ getContext: async () => current.ctx, BRANCH_COOKIE: "pos_branch" }));

import { paymentMethods, registers, roles, userBranchRoles } from "@/db/schema";
import type { ActionResult } from "@/lib/action-result";
import { insertAuthUser } from "@/lib/auth-users";
import { todayLocal } from "@/lib/dates";
import { ForbiddenError, type AppContext } from "@/lib/permissions";
import { DEFAULT_ROLES, type PermissionKey } from "@/lib/permissions-catalog";
import { arAging } from "@/lib/queries/customers";
import { getPosMenu } from "@/lib/queries/pos";
import { stockValuation } from "@/lib/queries/reports/inventory";
import { profitReport } from "@/lib/queries/reports/profit";
import { apAgingReport } from "@/lib/queries/reports/purchasing";
import { salesSummary } from "@/lib/queries/reports/sales";
import { listAudit } from "@/lib/queries/settings";
import { saveCustomer } from "@/lib/services/customers";
import { saveProduct } from "@/lib/services/menu";
import { verifyManagerPin } from "@/lib/services/pin";
import { createSupplier } from "@/lib/services/purchasing";
import { openShift } from "@/lib/services/shifts";
import { setUserPin } from "@/lib/services/users";
import { customerPaymentAction, saveCustomerAction } from "@/app/(app)/customers/actions";
import { createCountAction, createItemAction, saveAdjustmentAction } from "@/app/(app)/inventory/actions";
import { createTransferAction } from "@/app/(app)/inventory/transfers/actions";
import { createMenuCategoryAction, saveProductAction } from "@/app/(app)/menu/actions";
import { createSupplierAction, recordSupplierPaymentAction, saveAndPostReceiptAction, saveReceiptAction } from "@/app/(app)/purchasing/actions";
import { createBranchAction, createRoleAction, createUserAction } from "@/app/(app)/settings/actions";
import { setExchangeRateAction } from "@/app/(app)/settings/pos/actions";
import { cashMovementAction, closeShiftAction, openShiftAction, payAction, saveOrderAction } from "@/app/pos/actions";
import { closeTestDb, withRollback, type TestTx } from "./helpers/db";
import { createItem, createWorld } from "./helpers/fixtures";

afterAll(closeTestDb);
beforeEach(() => {
  current.ctx = null;
});

const PIN = "4321";
const TODAY = todayLocal();

async function setup(tx: TestTx) {
  const w = await createWorld(tx);
  const owner = await w.ctxFor(w.users.owner);
  const [reg1] = await tx.select().from(registers).where(eq(registers.branchId, w.b1.id));
  const [reg2] = await tx.insert(registers).values({ branchId: w.b1.id, name: "Register 2" }).returning();
  const item = await createItem(tx, w.org.id, { name: "Water bottle", base: "pcs" });
  await saveProduct(owner, null, { name: "Water", kitchenStation: "none", deductStock: true, modifierGroupIds: [], variants: [{ name: "Bottle", price: "2.00", deductStock: null, isDefault: true, recipe: [] }] });
  const variantId = (await getPosMenu(owner)).products[0].variants[0].id;
  const supplier = await createSupplier(owner, { name: "Acme", paymentTermsDays: 30 });
  const customer = await saveCustomer(owner, null, { name: "House", creditLimit: "100" });
  const methods = Object.fromEntries((await tx.select().from(paymentMethods).where(eq(paymentMethods.branchId, w.b1.id))).map((m) => [m.type, m.id]));
  const shift = await openShift(owner, { branchId: w.b1.id, registerId: reg1.id, floats: [{ currencyCode: "USD", amount: "50" }] });

  // One user per default role at B1, each with a PIN.
  const byRole = new Map<string, Actor>();
  const roleIds = new Map<string, string>();
  for (const role of DEFAULT_ROLES) {
    const [row] = await tx.select().from(roles).where(and(eq(roles.orgId, w.org.id), eq(roles.name, role.name)));
    roleIds.set(role.name, row.id);
    let userId = w.users.owner;
    if (role.name !== "Owner") {
      userId = await insertAuthUser(tx, { orgId: w.org.id, email: `${row.id}@test.local`, name: role.name, password: "matrix-pass-1" });
      await tx.insert(userBranchRoles).values({ userId, branchId: w.b1.id, roleId: row.id });
    }
    await setUserPin(owner, userId, PIN);
    byRole.set(role.name, { userId, ctx: await w.ctxFor(userId) });
  }
  return { ...w, tx, owner, reg1, reg2, item, variantId, supplier, customer, methods, shift, byRole, roleIds };
}
type F = Awaited<ReturnType<typeof setup>>;
type Actor = { userId: string; ctx: AppContext };
type Result = { ok: true } | { ok: false; error: string };

const cart = (f: F, extra: object = {}) => ({
  branchId: f.b1.id, registerId: f.reg1.id, orderType: "takeaway" as const, orderDiscount: null,
  lines: [{ variantId: f.variantId, qty: 1, modifierIds: [], discount: null }], ...extra,
});
const receipt = (f: F, purchaseType: "credit" | "direct") => ({
  branchId: f.b1.id, purchaseType, supplierId: f.supplier.id, receiptDate: TODAY, paymentTermsDays: 30,
  lines: [{ itemId: f.item.id, unitKey: "base", qty: "10", unitCost: "0.30" }],
});
const report = (f: F, branch = f.b1.id) => ({ branch, from: TODAY, to: TODAY });

/** A read query: allowed unless it throws ForbiddenError. */
const query = (fn: () => Promise<unknown>): Promise<Result> =>
  fn().then(() => ({ ok: true as const }), (err) => {
    if (err instanceof ForbiddenError) return { ok: false as const, error: err.message };
    throw err;
  });
/** A manager-PIN approval by `a`, requested by the owner. */
const approve = (f: F, a: Actor, permission: PermissionKey): Promise<Result> =>
  verifyManagerPin(f.owner, { branchId: f.b1.id, approverId: a.userId, pin: PIN, permission })
    .then(() => ({ ok: true as const }), (err: Error) => ({ ok: false as const, error: `Missing permission (${err.message})` }));

type Case = { name: string; needs: PermissionKey[]; anyOf?: boolean; run: (f: F, a: Actor) => Promise<ActionResult<unknown> | Result> };
const CASES: Case[] = [
  { name: "save an order", needs: ["pos.sell"], run: (f) => saveOrderAction(cart(f)) },
  { name: "hold a bill", needs: ["pos.sell", "pos.hold"], run: (f) => saveOrderAction(cart(f, { then: "hold" })) },
  { name: "discount within the limit", needs: ["pos.sell", "pos.discount.apply"], run: (f) => saveOrderAction(cart(f, { orderDiscount: { type: "percent", value: "5", reason: "Promotion" } })) },
  { name: "pay in cash", needs: ["pos.sell"], run: (f) => payAction(cart(f), { registerId: f.reg1.id, tenders: [{ methodId: f.methods.cash, currencyCode: "USD", amount: "2.00" }] }) },
  { name: "charge to account", needs: ["pos.sell", "pos.charge_account"], run: (f) => payAction(cart(f), { registerId: f.reg1.id, tenders: [{ methodId: f.methods.account, currencyCode: "USD", amount: "2.00" }], customerId: f.customer.id }) },
  { name: "open a shift", needs: ["shift.open"], run: (f) => openShiftAction({ branchId: f.b1.id, registerId: f.reg2.id, floats: [{ currencyCode: "USD", amount: "20" }] }) },
  { name: "close a shift", needs: ["shift.close"], run: (f) => closeShiftAction(f.shift.id, { counted: [{ currencyCode: "USD", amount: "50" }] }) },
  { name: "cash pay-in", needs: ["shift.cash_movement"], run: (f) => cashMovementAction({ branchId: f.b1.id, registerId: f.reg1.id, type: "pay_in", currencyCode: "USD", amount: "5", reason: "Change" }) },
  { name: "approve a void", needs: ["pos.void"], run: (f, a) => approve(f, a, "pos.void") },
  { name: "approve a refund", needs: ["pos.refund"], run: (f, a) => approve(f, a, "pos.refund") },
  { name: "approve a big discount", needs: ["pos.discount.override"], run: (f, a) => approve(f, a, "pos.discount.override") },
  { name: "approve a shift variance", needs: ["shift.close_variance_override"], run: (f, a) => approve(f, a, "shift.close_variance_override") },
  { name: "create an item", needs: ["inventory.manage_items"], run: () => createItemAction({ name: "New item", baseUnitCode: "g", units: [] }) },
  { name: "draft a stock adjustment", needs: ["inventory.adjust"], run: (f) => saveAdjustmentAction(null, { branchId: f.b1.id, reasonCode: "waste", lines: [{ itemId: f.item.id, unitKey: "base", qty: "-1" }] }) },
  { name: "start a stock count", needs: ["inventory.count"], run: (f) => createCountAction({ branchId: f.b1.id }) },
  { name: "draft a transfer", needs: ["inventory.transfer"], run: (f) => createTransferAction({ fromBranchId: f.b1.id, toBranchId: f.b2.id, lines: [{ itemId: f.item.id, unitKey: "base", qty: "1" }] }, false) },
  { name: "create a product", needs: ["menu.manage"], run: () => saveProductAction(null, { name: "Tea", variants: [{ name: "Cup", price: "1.50", isDefault: true }] }) },
  { name: "create a menu category", needs: ["menu.manage"], run: () => createMenuCategoryAction({ name: "Drinks" }) },
  { name: "create a supplier", needs: ["purchasing.receive", "purchasing.pay"], anyOf: true, run: () => createSupplierAction({ name: "New supplier" }) },
  { name: "draft a credit receipt", needs: ["purchasing.receive"], run: (f) => saveReceiptAction(null, receipt(f, "credit")) },
  { name: "post a direct purchase", needs: ["purchasing.direct"], run: (f) => saveAndPostReceiptAction(null, receipt(f, "direct"), { methodId: f.methods.cash, currencyCode: "USD" }) },
  { name: "pay a supplier", needs: ["purchasing.pay"], run: (f) => recordSupplierPaymentAction({ branchId: f.b1.id, supplierId: f.supplier.id, paymentDate: TODAY, amount: "10", methodId: f.methods.bank_transfer, currencyCode: "USD" }) },
  { name: "create a customer", needs: ["customers.manage"], run: () => saveCustomerAction(null, { name: "New customer" }) },
  { name: "take a customer payment", needs: ["ar.receive_payment"], run: (f) => customerPaymentAction({ customerId: f.customer.id, branchId: f.b1.id, registerId: f.reg1.id, methodId: f.methods.cash, currencyCode: "USD", amount: "5" }) },
  { name: "create a branch", needs: ["settings.manage"], run: () => createBranchAction({ code: "B9", name: "New branch" }) },
  { name: "set the exchange rate", needs: ["settings.manage"], run: (f) => setExchangeRateAction({ branchId: f.b1.id, currencyCode: "KHR", rate: "4050" }) },
  { name: "create a user", needs: ["users.manage"], run: (f) => createUserAction({ email: "new@test.local", name: "New", password: "new-user-pass-1", branchId: f.b1.id, roleId: f.roleIds.get("Barista/Kitchen")! }) },
  { name: "create a role", needs: ["roles.manage"], run: () => createRoleAction({ name: "Trainee", permissions: [] }) },
  { name: "sales report", needs: ["reports.sales"], run: (f, a) => query(() => salesSummary(a.ctx, report(f))) },
  { name: "sales report, all branches", needs: ["reports.sales", "reports.all_branches"], run: (f, a) => query(() => salesSummary(a.ctx, report(f, "all"))) },
  { name: "profit report", needs: ["reports.profit"], run: (f, a) => query(() => profitReport(a.ctx, report(f))) },
  { name: "stock valuation", needs: ["reports.inventory"], run: (f, a) => query(() => stockValuation(a.ctx, { branch: f.b1.id, asOf: TODAY, unit: "base" })) },
  { name: "AP aging", needs: ["reports.ap"], run: (f, a) => query(() => apAgingReport(a.ctx, { branch: f.b1.id, asOf: TODAY })) },
  { name: "AR aging", needs: ["reports.ar"], run: (_f, a) => query(() => arAging(a.ctx, { asOf: TODAY })) },
  { name: "audit log", needs: ["audit.view"], run: (_f, a) => query(() => listAudit(a.ctx, {})) },
];

const DENIED = /Missing permission|don't have access|You can't/;

describe("permission matrix", () => {
  for (const role of DEFAULT_ROLES) {
    it(`${role.name} can do exactly what the matrix allows`, async () => {
      await withRollback(async (tx) => {
        const f = await setup(tx);
        const actor = f.byRole.get(role.name)!;
        const wrong: string[] = [];
        for (const c of CASES) {
          const has = (k: PermissionKey) => k in role.permissions;
          const allowed = c.anyOf ? c.needs.some(has) : c.needs.every(has);
          let result!: ActionResult<unknown> | Result;
          try {
            await tx.transaction(async (sp) => {
              current.ctx = actor.ctx;
              result = await c.run(f, actor);
              sp.rollback();
            });
          } catch (err) {
            if (!(err instanceof TransactionRollbackError)) throw err;
          }
          // "Needs a manager PIN" is a denial too: the role can't do it alone.
          const denied = !result.ok && (DENIED.test(result.error) || ("code" in result && result.code === "approval_required"));
          // An allowed action must really succeed, so a typo in a case can't pass as "not denied".
          if (allowed && !result.ok) wrong.push(`${c.name}: should be allowed, got "${result.error}"`);
          if (!allowed && !denied) wrong.push(`${c.name}: should be denied, got ${result.ok ? "success" : `"${result.error}"`}`);
        }
        expect(wrong).toEqual([]);
      });
    }, 120_000);
  }
});
