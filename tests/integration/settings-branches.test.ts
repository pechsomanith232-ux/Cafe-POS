import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { auditLog, branches, userBranchRoles } from "@/db/schema";
import { ConflictError, ValidationError } from "@/lib/errors";
import { ForbiddenError } from "@/lib/permissions";
import { createBranch, setBranchActive, updateBranch } from "@/lib/services/branches";
import { closeTestDb, withRollback } from "./helpers/db";
import { createWorld } from "./helpers/fixtures";

afterAll(closeTestDb);

describe("branches service", () => {
  it("lets the owner create a branch, joins them to it and audits it", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = await w.ctxFor(w.users.owner);
      const b = await createBranch(ctx, { code: "B3", name: "Airport" });
      expect(b.code).toBe("B3");
      const [link] = await tx.select().from(userBranchRoles).where(eq(userBranchRoles.branchId, b.id));
      expect(link).toMatchObject({ userId: w.users.owner, roleId: w.roleIds.owner });
      const [log] = await tx.select().from(auditLog).where(eq(auditLog.action, "branch.create"));
      expect(log).toMatchObject({ entityId: b.id, userId: w.users.owner });
    });
  });

  it("rejects a cashier and writes nothing", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = await w.ctxFor(w.users.cashier);
      await expect(createBranch(ctx, { code: "B9", name: "X" })).rejects.toThrow(ForbiddenError);
      expect(await tx.select().from(branches).where(eq(branches.code, "B9"))).toHaveLength(0);
    });
  });

  it("rejects a duplicate branch code with a clear message", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = await w.ctxFor(w.users.owner);
      await expect(createBranch(ctx, { code: "b2", name: "Again" })).rejects.toThrow(ConflictError);
    });
  });

  it("validates input", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = await w.ctxFor(w.users.owner);
      await expect(createBranch(ctx, { code: "", name: "No code" })).rejects.toThrow(ValidationError);
    });
  });

  it("audits updates with before and after", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = await w.ctxFor(w.users.owner);
      await updateBranch(ctx, w.b1.id, { code: "B1", name: "Main Street", taxRate: "10" });
      const [log] = await tx.select().from(auditLog).where(eq(auditLog.action, "branch.update"));
      expect(log.before).toMatchObject({ name: "Main", taxRate: "0.00" });
      expect(log.after).toMatchObject({ name: "Main Street", taxRate: "10.00" });
    });
  });

  it("rejects editing a branch the user doesn't belong to", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = await w.ctxFor(w.users.owner); // owner belongs to B1 only
      await expect(updateBranch(ctx, w.b2.id, { code: "B2", name: "Hacked" })).rejects.toThrow(ForbiddenError);
    });
  });

  it("can reactivate a branch after deactivating it", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = await w.ctxFor(w.users.owner);
      const b3 = await createBranch(ctx, { code: "B3", name: "Airport" });
      await setBranchActive(await w.ctxFor(w.users.owner), b3.id, false);
      const ctxAfter = await w.ctxFor(w.users.owner);
      expect(ctxAfter.branchIds).not.toContain(b3.id);
      await setBranchActive(ctxAfter, b3.id, true);
      const [row] = await tx.select().from(branches).where(eq(branches.id, b3.id));
      expect(row.isActive).toBe(true);
    });
  });

  it("won't deactivate the user's last active branch", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = await w.ctxFor(w.users.owner);
      await expect(setBranchActive(ctx, w.b1.id, false)).rejects.toThrow(ValidationError);
    });
  });
});
