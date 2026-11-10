import { and, asc, count, eq } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { branches, currencies, orders, registers, shiftCash, shifts } from "@/db/schema";
import { readBranchSettings } from "@/lib/branch-settings";
import { dec, toMoneyString } from "@/lib/domain/money";
import { ApprovalRequiredError, ConflictError, NotFoundError, parseInput, ValidationError } from "@/lib/errors";
import { assertBranchAccess, requirePermission, type AppContext } from "@/lib/permissions";
import { closeShiftInput, openShiftInput, type CloseShiftInput, type OpenShiftInput } from "@/lib/validators/pos";
import { writeAudit } from "./audit";
import { currencyAt } from "./currency-rates";
import { verifyManagerPin } from "./pin";
import { expectedCash } from "./shift-cash";
import { inTransaction } from "./tx";

// Shifts (plan §4.8). Phase 5: open with a float per currency; close with the
// counted cash. Phase 6 adds cash sales/refunds/pay-ins to "expected" and the
// variance approval.

/** The register must be an active register of the branch. */
export async function assertRegister(tx: Executor, branchId: string, registerId: string) {
  const [r] = await tx.select().from(registers).where(and(eq(registers.id, registerId), eq(registers.branchId, branchId), eq(registers.isActive, true)));
  if (!r) throw new ValidationError("That register isn't at this branch.");
  return r;
}

/** The open shift of a register, or a clear error telling the cashier to open one. */
export async function requireOpenShift(tx: Executor, branchId: string, registerId: string) {
  await assertRegister(tx, branchId, registerId);
  // FOR SHARE: closeShift's FOR UPDATE waits until this transaction ends, so an
  // order can't be written to a shift that is closing at the same moment.
  const [s] = await tx.select().from(shifts).where(and(eq(shifts.registerId, registerId), eq(shifts.status, "open"))).for("share");
  if (!s) throw new ValidationError("Open a shift on this register first.");
  return s;
}

export async function openShift(ctx: AppContext, input: OpenShiftInput) {
  const data = parseInput(openShiftInput, input);
  assertBranchAccess(ctx, data.branchId);
  requirePermission(ctx, data.branchId, "shift.open");
  return inTransaction(ctx, async (tx, ctx) => {
    const reg = await assertRegister(tx, data.branchId, data.registerId);
    // Lock the register row so two cashiers opening at once are serialized.
    await tx.select({ id: registers.id }).from(registers).where(eq(registers.id, reg.id)).for("update");
    const [already] = await tx.select({ id: shifts.id }).from(shifts).where(and(eq(shifts.registerId, reg.id), eq(shifts.status, "open")));
    if (already) throw new ConflictError(`${reg.name} already has an open shift.`);
    const all = await tx.select().from(currencies).orderBy(asc(currencies.code));
    for (const f of data.floats) {
      if (!all.some((c) => c.code === f.currencyCode)) throw new ValidationError(`Unknown currency ${f.currencyCode}.`);
    }
    const [shift] = await tx.insert(shifts).values({ branchId: data.branchId, registerId: reg.id, openedBy: ctx.userId, notes: data.notes }).returning();
    const floats = all.map((c) => ({ shiftId: shift.id, currencyCode: c.code, openingFloat: data.floats.find((f) => f.currencyCode === c.code)?.amount ?? "0" }));
    await tx.insert(shiftCash).values(floats);
    await writeAudit(tx, ctx, {
      action: "shift.open", entity: "shift", entityId: shift.id, branchId: data.branchId,
      after: { register: reg.name, floats: Object.fromEntries(floats.map((f) => [f.currencyCode, f.openingFloat])) },
    });
    return shift;
  });
}

export async function closeShift(ctx: AppContext, shiftId: string, input: CloseShiftInput) {
  const data = parseInput(closeShiftInput, input);
  const [s0] = await ctx.db.select({ branchId: shifts.branchId }).from(shifts).where(eq(shifts.id, shiftId));
  if (!s0) throw new NotFoundError("Shift not found.");
  assertBranchAccess(ctx, s0.branchId);
  requirePermission(ctx, s0.branchId, "shift.close");
  // PIN first, outside the transaction, so failed tries always count.
  const approverId = data.approval
    ? await verifyManagerPin(ctx, { branchId: s0.branchId, ...data.approval, permission: "shift.close_variance_override" })
    : null;
  return inTransaction(ctx, async (tx, ctx) => {
    const [shift] = await tx.select().from(shifts).where(eq(shifts.id, shiftId)).for("update");
    if (shift.status !== "open") throw new ConflictError("This shift is already closed.");
    // Every unpaid order must be held (it moves to the next shift) or finished first.
    const [{ open }] = await tx.select({ open: count() }).from(orders).where(and(eq(orders.shiftId, shiftId), eq(orders.status, "open")));
    if (open > 0) throw new ConflictError(`${open} order${open === 1 ? " is" : "s are"} still open on this shift — hold or finish ${open === 1 ? "it" : "them"} first.`);

    const [branch] = await tx.select().from(branches).where(eq(branches.id, shift.branchId));
    const settings = readBranchSettings(branch.settings);
    const cash = [];
    let varianceBase = dec(0);
    for (const r of await expectedCash(tx, shiftId)) {
      const counted = dec(data.counted.find((c) => c.currencyCode === r.currencyCode)?.amount ?? "0");
      const variance = counted.minus(r.expected);
      if (!variance.isZero()) varianceBase = varianceBase.plus(variance.div((await currencyAt(tx, shift.branchId, r.currencyCode)).rate));
      cash.push({ currencyCode: r.currencyCode, openingFloat: r.openingFloat, expected: r.expected, counted: toMoneyString(counted), variance: toMoneyString(variance) });
    }
    // Plan §4.8 + owner's Q6: a variance above the threshold needs a manager's PIN, unless switched off.
    const over = varianceBase.abs().gt(settings.varianceThreshold);
    // Plan §2 rule 10: a cash difference above the threshold needs a reason, PIN or not.
    if (over && !data.notes) throw new ValidationError("Give a reason for the cash difference.");
    if (over && settings.variancePinRequired && !approverId) {
      throw new ApprovalRequiredError(`The cash is off by $${varianceBase.abs().toFixed(2)} (more than $${settings.varianceThreshold}). A manager's PIN is needed to close.`, "shift.close_variance_override");
    }
    for (const c of cash) {
      await tx.update(shiftCash).set({ expected: c.expected, counted: c.counted, variance: c.variance }).where(and(eq(shiftCash.shiftId, shiftId), eq(shiftCash.currencyCode, c.currencyCode)));
    }
    const [closed] = await tx.update(shifts).set({ status: "closed", closedBy: ctx.userId, closedAt: new Date(), notes: data.notes ?? shift.notes })
      .where(eq(shifts.id, shiftId)).returning();
    await writeAudit(tx, ctx, {
      action: "shift.close", entity: "shift", entityId: shiftId, branchId: shift.branchId, approvedBy: over && approverId ? approverId : null, reason: over ? data.notes : null,
      after: { cash, varianceBase: toMoneyString(varianceBase), threshold: settings.varianceThreshold, pinRequired: settings.variancePinRequired },
    });
    return { shift: closed, cash, varianceBase: toMoneyString(varianceBase) };
  });
}
