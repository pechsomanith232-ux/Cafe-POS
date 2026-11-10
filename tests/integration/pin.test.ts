import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { auditLog, pinAttempts, profiles } from "@/db/schema";
import { PinError, ValidationError } from "@/lib/errors";
import { ForbiddenError } from "@/lib/permissions";
import { listPinApprovers, verifyManagerPin } from "@/lib/services/pin";
import { setUserPin } from "@/lib/services/users";
import { closeTestDb, withRollback } from "./helpers/db";
import { createWorld } from "./helpers/fixtures";

afterAll(closeTestDb);

async function worldWithPins(tx: Parameters<Parameters<typeof withRollback>[0]>[0]) {
  const w = await createWorld(tx);
  const ownerCtx = await w.ctxFor(w.users.owner);
  await setUserPin(ownerCtx, w.users.manager, "4321");
  await setUserPin(ownerCtx, w.users.cashier, "1111");
  const cashierCtx = await w.ctxFor(w.users.cashier);
  return { ...w, ownerCtx, cashierCtx };
}

describe("setUserPin", () => {
  it("stores a hash, not the PIN, and audits without the PIN", async () => {
    await withRollback(async (tx) => {
      const w = await worldWithPins(tx);
      const [p] = await tx.select().from(profiles).where(eq(profiles.userId, w.users.manager));
      expect(p.pinHash).toMatch(/^\$argon2/);
      const logs = await tx.select().from(auditLog).where(eq(auditLog.action, "user.pin_set"));
      expect(logs.length).toBeGreaterThan(0);
      expect(JSON.stringify(logs)).not.toContain("4321");
    });
  });

  it("only accepts 4–6 digits", async () => {
    await withRollback(async (tx) => {
      const w = await worldWithPins(tx);
      await expect(setUserPin(w.ownerCtx, w.users.manager, "12")).rejects.toThrow(ValidationError);
      await expect(setUserPin(w.ownerCtx, w.users.manager, "12ab")).rejects.toThrow(ValidationError);
    });
  });

  it("lets users set their own PIN", async () => {
    await withRollback(async (tx) => {
      const w = await worldWithPins(tx);
      await expect(setUserPin(w.cashierCtx, w.users.cashier, "2468")).resolves.toBeUndefined();
    });
  });
});

describe("verifyManagerPin", () => {
  it("approves with the manager's PIN and returns the approver", async () => {
    await withRollback(async (tx) => {
      const w = await worldWithPins(tx);
      const approver = await verifyManagerPin(w.cashierCtx, {
        branchId: w.b1.id, approverId: w.users.manager, pin: "4321", permission: "pos.void",
      });
      expect(approver).toBe(w.users.manager);
    });
  });

  it("rejects a wrong PIN and records the attempt", async () => {
    await withRollback(async (tx) => {
      const w = await worldWithPins(tx);
      await expect(
        verifyManagerPin(w.cashierCtx, { branchId: w.b1.id, approverId: w.users.manager, pin: "0000", permission: "pos.void" }),
      ).rejects.toThrow(PinError);
      const attempts = await tx.select().from(pinAttempts);
      expect(attempts).toHaveLength(1);
      expect(attempts[0].success).toBe(false);
    });
  });

  it("rejects an approver whose role lacks the permission, even with the right PIN", async () => {
    await withRollback(async (tx) => {
      const w = await worldWithPins(tx);
      await expect(
        verifyManagerPin(w.cashierCtx, { branchId: w.b1.id, approverId: w.users.cashier, pin: "1111", permission: "pos.void" }),
      ).rejects.toThrow(PinError);
    });
  });

  it("locks after 5 failed tries in 5 minutes, even for the right PIN", async () => {
    await withRollback(async (tx) => {
      const w = await worldWithPins(tx);
      const attempt = (pin: string) =>
        verifyManagerPin(w.cashierCtx, { branchId: w.b1.id, approverId: w.users.manager, pin, permission: "pos.void" });
      for (let i = 0; i < 5; i++) await expect(attempt("9999")).rejects.toThrow(/incorrect/i);
      await expect(attempt("4321")).rejects.toThrow(/too many/i);
    });
  });

  it("ignores failures older than 5 minutes", async () => {
    await withRollback(async (tx) => {
      const w = await worldWithPins(tx);
      const old = new Date(Date.now() - 6 * 60 * 1000);
      await tx.insert(pinAttempts).values(
        Array.from({ length: 5 }, () => ({ actorUserId: w.users.cashier, approverUserId: w.users.manager, branchId: w.b1.id, success: false, createdAt: old })),
      );
      await expect(
        verifyManagerPin(w.cashierCtx, { branchId: w.b1.id, approverId: w.users.manager, pin: "4321", permission: "pos.void" }),
      ).resolves.toBe(w.users.manager);
    });
  });

  it("rejects a branch the requesting user doesn't belong to", async () => {
    await withRollback(async (tx) => {
      const w = await worldWithPins(tx);
      await expect(
        verifyManagerPin(w.cashierCtx, { branchId: w.b2.id, approverId: w.users.manager, pin: "4321", permission: "pos.void" }),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  it("rejects a deactivated approver", async () => {
    await withRollback(async (tx) => {
      const w = await worldWithPins(tx);
      await tx.update(profiles).set({ isActive: false }).where(eq(profiles.userId, w.users.manager));
      await expect(
        verifyManagerPin(w.cashierCtx, { branchId: w.b1.id, approverId: w.users.manager, pin: "4321", permission: "pos.void" }),
      ).rejects.toThrow(PinError);
    });
  });
});

describe("listPinApprovers", () => {
  it("lists active users at the branch who have the permission and a PIN", async () => {
    await withRollback(async (tx) => {
      const w = await worldWithPins(tx);
      const list = await listPinApprovers(w.cashierCtx, w.b1.id, "pos.void");
      expect(list.map((a) => a.userId)).toEqual([w.users.manager]);
    });
  });
});
