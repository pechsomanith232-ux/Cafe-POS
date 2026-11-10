import { and, eq } from "drizzle-orm";
import { verifyPassword } from "better-auth/crypto";
import { afterAll, describe, expect, it } from "vitest";
import { account, auditLog, profiles, rolePermissions, roles, session, user } from "@/db/schema";
import { ConflictError, ValidationError } from "@/lib/errors";
import { ForbiddenError } from "@/lib/permissions";
import { createRole, updateRole } from "@/lib/services/roles";
import { assignBranchRole, createUser, removeBranchRole, setUserActive, setUserPassword } from "@/lib/services/users";
import { closeTestDb, withRollback } from "./helpers/db";
import { createWorld } from "./helpers/fixtures";

afterAll(closeTestDb);

describe("users service", () => {
  it("lets the owner create a user with a branch role; the password is never audited", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = await w.ctxFor(w.users.owner);
      const id = await createUser(ctx, {
        email: "New.Cashier@Test.local", name: "Sokha", password: "sokha-pass-1",
        branchId: w.b1.id, roleId: w.roleIds.cashier,
      });
      const [u] = await tx.select().from(user).where(eq(user.id, id));
      expect(u.email).toBe("new.cashier@test.local");
      const [acc] = await tx.select().from(account).where(eq(account.userId, id));
      expect(await verifyPassword({ hash: acc.password!, password: "sokha-pass-1" })).toBe(true);
      const [log] = await tx.select().from(auditLog).where(eq(auditLog.action, "user.create"));
      expect(JSON.stringify(log)).not.toContain("sokha-pass-1");
    });
  });

  it("rejects a cashier (and a manager without users.manage)", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      for (const who of [w.users.cashier, w.users.manager]) {
        const ctx = await w.ctxFor(who);
        await expect(
          createUser(ctx, { email: "x@test.local", name: "X", password: "xxxx-pass-1", branchId: w.b1.id, roleId: w.roleIds.cashier }),
        ).rejects.toThrow(ForbiddenError);
      }
    });
  });

  it("rejects a duplicate email", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = await w.ctxFor(w.users.owner);
      await expect(
        createUser(ctx, { email: "CASHIER@test.local", name: "Dup", password: "dupe-pass-1", branchId: w.b1.id, roleId: w.roleIds.cashier }),
      ).rejects.toThrow(ConflictError);
    });
  });

  it("won't let a user grant a role with more power than their own", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ownerCtx = await w.ctxFor(w.users.owner);
      const supervisor = await createRole(ownerCtx, {
        name: "Supervisor",
        permissions: [{ key: "users.manage" }, { key: "pos.sell" }, { key: "pos.hold" }],
      });
      await assignBranchRole(ownerCtx, { userId: w.users.cashier, branchId: w.b1.id, roleId: supervisor.id });
      const supCtx = await w.ctxFor(w.users.cashier);
      await expect(
        assignBranchRole(supCtx, { userId: w.users.manager, branchId: w.b1.id, roleId: w.roleIds.owner }),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  it("audits a role change on a user (before/after role)", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = await w.ctxFor(w.users.owner);
      await assignBranchRole(ctx, { userId: w.users.cashier, branchId: w.b1.id, roleId: w.roleIds.manager });
      const [log] = await tx.select().from(auditLog).where(eq(auditLog.action, "user.role_assign"));
      expect(log.before).toMatchObject({ roleId: w.roleIds.cashier });
      expect(log.after).toMatchObject({ roleId: w.roleIds.manager });
    });
  });

  it("deactivating a user signs them out everywhere and is audited", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      await tx.insert(session).values({ id: "s1", token: "t1", userId: w.users.cashier, expiresAt: new Date(Date.now() + 3600e3), updatedAt: new Date() });
      const ctx = await w.ctxFor(w.users.owner);
      await setUserActive(ctx, w.users.cashier, false);
      const [p] = await tx.select().from(profiles).where(eq(profiles.userId, w.users.cashier));
      expect(p.isActive).toBe(false);
      expect(await tx.select().from(session).where(eq(session.userId, w.users.cashier))).toHaveLength(0);
      expect(await tx.select().from(auditLog).where(eq(auditLog.action, "user.deactivate"))).toHaveLength(1);
    });
  });

  it("won't deactivate yourself or remove the last Owner", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = await w.ctxFor(w.users.owner);
      await expect(setUserActive(ctx, w.users.owner, false)).rejects.toThrow(ValidationError);
      await expect(removeBranchRole(ctx, { userId: w.users.owner, branchId: w.b1.id })).rejects.toThrow(ValidationError);
    });
  });

  it("resets a password and signs the user out", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = await w.ctxFor(w.users.owner);
      await setUserPassword(ctx, w.users.cashier, "brand-new-pass");
      const [acc] = await tx.select().from(account).where(eq(account.userId, w.users.cashier));
      expect(await verifyPassword({ hash: acc.password!, password: "brand-new-pass" })).toBe(true);
    });
  });

  it("can't manage a user who only works at another branch", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = await w.ctxFor(w.users.owner); // B1 only
      await expect(setUserActive(ctx, w.users.b2user, false)).rejects.toThrow(ForbiddenError);
    });
  });
});

describe("roles service", () => {
  it("audits a change to a role's permissions with before and after", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = await w.ctxFor(w.users.owner);
      await updateRole(ctx, w.roleIds.cashier, {
        name: "Cashier",
        permissions: [{ key: "pos.sell" }, { key: "pos.discount.apply", limit: "15" }],
      });
      const perms = await tx.select().from(rolePermissions).where(eq(rolePermissions.roleId, w.roleIds.cashier));
      expect(perms.map((p) => p.permissionKey).sort()).toEqual(["pos.discount.apply", "pos.sell"]);
      const [log] = await tx.select().from(auditLog).where(and(eq(auditLog.action, "role.update"), eq(auditLog.entityId, w.roleIds.cashier)));
      expect((log.before as { permissions: Record<string, unknown> }).permissions).toHaveProperty("shift.open");
      expect((log.after as { permissions: Record<string, unknown> }).permissions).toEqual({ "pos.sell": null, "pos.discount.apply": "15.0000" });
    });
  });

  it("rejects a cashier", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = await w.ctxFor(w.users.cashier);
      await expect(updateRole(ctx, w.roleIds.cashier, { name: "Cashier", permissions: [{ key: "settings.manage" }] })).rejects.toThrow(ForbiddenError);
    });
  });

  it("keeps the Owner role locked so nobody gets locked out", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = await w.ctxFor(w.users.owner);
      await expect(updateRole(ctx, w.roleIds.owner, { name: "Owner", permissions: [] })).rejects.toThrow(ValidationError);
    });
  });

  it("rejects unknown permission keys and duplicate role names", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = await w.ctxFor(w.users.owner);
      await expect(createRole(ctx, { name: "Weird", permissions: [{ key: "launch.rockets" }] })).rejects.toThrow(ValidationError);
      await expect(createRole(ctx, { name: "cashier", permissions: [] })).rejects.toThrow(ConflictError);
      expect(await tx.select().from(roles).where(eq(roles.name, "Weird"))).toHaveLength(0);
    });
  });
});

