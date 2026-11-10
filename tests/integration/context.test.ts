import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { auditLog, branches, profiles } from "@/db/schema";
import { NoBranchAccessError, UnauthorizedError } from "@/lib/context-builder";
import { ForbiddenError, branchScope, hasPermission } from "@/lib/permissions";
import { writeAudit } from "@/lib/services/audit";
import { insertAuthUser } from "@/lib/auth-users";
import { closeTestDb, withRollback } from "./helpers/db";
import { createWorld } from "./helpers/fixtures";

afterAll(closeTestDb);

describe("buildContext", () => {
  it("uses the requested branch when the user belongs to it", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = await w.ctxFor(w.users.mixed, w.b2.id);
      expect(ctx.branchId).toBe(w.b2.id);
      expect(ctx.branchIds.sort()).toEqual([w.b1.id, w.b2.id].sort());
      expect(ctx.orgId).toBe(w.org.id);
      expect(ctx.db).toBe(tx);
    });
  });

  it("ignores a branch cookie for a branch the user doesn't belong to", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = await w.ctxFor(w.users.cashier, w.b2.id);
      expect(ctx.branchId).toBe(w.b1.id);
      expect(ctx.branchIds).toEqual([w.b1.id]);
    });
  });

  it("loads a different role per branch", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = await w.ctxFor(w.users.mixed);
      expect(ctx.access.get(w.b1.id)?.roleName).toBe("Manager");
      expect(ctx.access.get(w.b2.id)?.roleName).toBe("Cashier");
      expect(hasPermission(ctx, w.b1.id, "pos.void")).toBe(true);
      expect(hasPermission(ctx, w.b2.id, "pos.void")).toBe(false);
      expect(ctx.access.get(w.b2.id)?.permissions.get("pos.discount.apply")).toBe("10.0000");
    });
  });

  it("leaves out deactivated branches", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      await tx.update(branches).set({ isActive: false }).where(eq(branches.id, w.b2.id));
      const ctx = await w.ctxFor(w.users.mixed, w.b2.id);
      expect(ctx.branchIds).toEqual([w.b1.id]);
    });
  });

  it("rejects a deactivated user", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      await tx.update(profiles).set({ isActive: false }).where(eq(profiles.userId, w.users.cashier));
      await expect(w.ctxFor(w.users.cashier)).rejects.toThrow(UnauthorizedError);
    });
  });

  it("rejects a user with no branch", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const id = await insertAuthUser(tx, { orgId: w.org.id, email: "nobody@test.local", name: "Nobody", password: "nobody-pass-1" });
      await expect(w.ctxFor(id)).rejects.toThrow(NoBranchAccessError);
    });
  });
});

describe("branchScope (a user can't read another branch's data)", () => {
  it("limits rows to the user's own branches", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = await w.ctxFor(w.users.cashier);
      const rows = await tx.select({ id: branches.id }).from(branches).where(branchScope(ctx, branches.id));
      expect(rows.map((r) => r.id)).toEqual([w.b1.id]);
    });
  });

  it("refuses to scope to another branch", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = await w.ctxFor(w.users.cashier);
      expect(() => branchScope(ctx, branches.id, { branchId: w.b2.id })).toThrow(ForbiddenError);
    });
  });
});

describe("writeAudit", () => {
  it("records who did what, with before/after", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = { ...(await w.ctxFor(w.users.manager)), ip: "10.0.0.9" };
      await writeAudit(tx, ctx, {
        action: "branch.update",
        entity: "branch",
        entityId: w.b1.id,
        branchId: w.b1.id,
        before: { name: "Main" },
        after: { name: "Main Street" },
        reason: "rename",
      });
      const [row] = await tx.select().from(auditLog);
      expect(row).toMatchObject({
        orgId: w.org.id,
        userId: w.users.manager,
        action: "branch.update",
        entityId: w.b1.id,
        before: { name: "Main" },
        after: { name: "Main Street" },
        ip: "10.0.0.9",
      });
    });
  });
});
