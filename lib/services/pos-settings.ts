import { and, eq, ne, sql } from "drizzle-orm";
import { branches, currencies, diningTables, exchangeRates, paymentMethods } from "@/db/schema";
import { readBranchSettings } from "@/lib/branch-settings";
import { ConflictError, NotFoundError, parseInput, ValidationError } from "@/lib/errors";
import { assertBranchAccess, requirePermission, type AppContext } from "@/lib/permissions";
import { branchPosSettingsInput, diningTableInput, exchangeRateInput, paymentMethodInput, type BranchPosSettingsInput, type DiningTableInput, type PaymentMethodInput } from "@/lib/validators/pos";
import { writeAudit } from "./audit";
import { inTransaction } from "./tx";

/** Create (id = null) or update a dining table of a branch (settings.manage). */
export async function saveDiningTable(ctx: AppContext, id: string | null, input: DiningTableInput) {
  const data = parseInput(diningTableInput, input);
  assertBranchAccess(ctx, data.branchId);
  requirePermission(ctx, data.branchId, "settings.manage");
  return inTransaction(ctx, async (tx, ctx) => {
    const [dupe] = await tx.select({ id: diningTables.id }).from(diningTables)
      .where(and(eq(diningTables.branchId, data.branchId), sql`lower(${diningTables.name}) = lower(${data.name})`, id ? ne(diningTables.id, id) : undefined));
    if (dupe) throw new ConflictError(`There's already a table named "${data.name}".`);
    if (id) {
      const [before] = await tx.select().from(diningTables).where(and(eq(diningTables.id, id), eq(diningTables.branchId, data.branchId))).for("update");
      if (!before) throw new NotFoundError("Table not found.");
      const [t] = await tx.update(diningTables).set(data).where(eq(diningTables.id, id)).returning();
      await writeAudit(tx, ctx, { action: "table.update", entity: "dining_table", entityId: id, branchId: data.branchId, before: { name: before.name, isActive: before.isActive }, after: data });
      return t;
    }
    const [t] = await tx.insert(diningTables).values(data).returning();
    await writeAudit(tx, ctx, { action: "table.create", entity: "dining_table", entityId: t.id, branchId: data.branchId, after: data });
    return t;
  });
}

/** A new exchange rate for a branch, effective now; history is kept (plan §4.4). */
export async function setExchangeRate(ctx: AppContext, input: { branchId: string; currencyCode: string; rate: string }) {
  const data = parseInput(exchangeRateInput, input);
  assertBranchAccess(ctx, data.branchId);
  requirePermission(ctx, data.branchId, "settings.manage");
  await inTransaction(ctx, async (tx, ctx) => {
    const [c] = await tx.select().from(currencies).where(eq(currencies.code, data.currencyCode));
    if (!c || c.code === "USD") throw new ValidationError("Choose a secondary currency (e.g. KHR).");
    const [row] = await tx.insert(exchangeRates).values({ branchId: data.branchId, currencyCode: c.code, rateToBase: data.rate, createdBy: ctx.userId }).returning();
    await writeAudit(tx, ctx, { action: "exchange_rate.set", entity: "exchange_rate", entityId: row.id, branchId: data.branchId, after: { currency: c.code, rate: data.rate } });
  });
}

/** Create (id = null) or update one of the active branch's payment methods (settings.manage there). */
export async function savePaymentMethod(ctx: AppContext, id: string | null, input: PaymentMethodInput) {
  requirePermission(ctx, ctx.branchId, "settings.manage");
  const data = parseInput(paymentMethodInput, input);
  return inTransaction(ctx, async (tx, ctx) => {
    const [dupe] = await tx.select({ id: paymentMethods.id }).from(paymentMethods)
      .where(and(eq(paymentMethods.branchId, ctx.branchId), sql`lower(${paymentMethods.name}) = lower(${data.name})`, id ? ne(paymentMethods.id, id) : undefined));
    if (dupe) throw new ConflictError(`There's already a payment method named "${data.name}".`);
    if (id) {
      const [before] = await tx.select().from(paymentMethods).where(and(eq(paymentMethods.id, id), eq(paymentMethods.branchId, ctx.branchId))).for("update");
      if (!before) throw new NotFoundError("Payment method not found.");
      const [m] = await tx.update(paymentMethods).set(data).where(eq(paymentMethods.id, id)).returning();
      await writeAudit(tx, ctx, { action: "payment_method.update", entity: "payment_method", entityId: id, branchId: ctx.branchId, before: { name: before.name, type: before.type, isActive: before.isActive }, after: data });
      return m;
    }
    const [m] = await tx.insert(paymentMethods).values({ ...data, orgId: ctx.orgId, branchId: ctx.branchId }).returning();
    await writeAudit(tx, ctx, { action: "payment_method.create", entity: "payment_method", entityId: m.id, branchId: ctx.branchId, after: data });
    return m;
  });
}

/** Branch POS settings: shift variance threshold, the PIN switch (owner's Q6) and negative stock. */
export async function saveBranchPosSettings(ctx: AppContext, input: BranchPosSettingsInput) {
  const data = parseInput(branchPosSettingsInput, input);
  assertBranchAccess(ctx, data.branchId);
  requirePermission(ctx, data.branchId, "settings.manage");
  await inTransaction(ctx, async (tx, ctx) => {
    const [b] = await tx.select().from(branches).where(eq(branches.id, data.branchId)).for("update");
    const before = readBranchSettings(b.settings);
    const after = { ...(b.settings as Record<string, unknown>), varianceThreshold: data.varianceThreshold, variancePinRequired: data.variancePinRequired, allowNegativeStock: data.allowNegativeStock, kitchenEnabled: data.kitchenEnabled };
    await tx.update(branches).set({ settings: after }).where(eq(branches.id, data.branchId));
    await writeAudit(tx, ctx, { action: "branch.pos_settings", entity: "branch", entityId: data.branchId, branchId: data.branchId, before, after: readBranchSettings(after) });
  });
}
