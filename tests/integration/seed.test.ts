import { and, count, eq } from "drizzle-orm";
import { verifyPassword } from "better-auth/crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  account,
  branches,
  organizations,
  permissions,
  profiles,
  rolePermissions,
  roles,
  user,
  userBranchRoles,
} from "@/db/schema";
import { seedDatabase } from "@/db/seed-data";
import { DEFAULT_ROLES, PERMISSION_KEYS } from "@/lib/permissions-catalog";
import { closeTestDb, withRollback } from "./helpers/db";

afterAll(closeTestDb);

const input = {
  orgName: "Oshare Café",
  branch: { code: "B1", name: "Main Branch" },
  owner: { email: "owner@example.com", password: "owner-pass-123", name: "Owner" },
};

describe("seedDatabase", () => {
  it("creates permissions, default roles, the first branch and the Owner", async () => {
    await withRollback(async (tx) => {
      await seedDatabase(tx, input);

      expect((await tx.select({ n: count() }).from(permissions))[0].n).toBe(PERMISSION_KEYS.length);
      const roleRows = await tx.select().from(roles);
      expect(roleRows.map((r) => r.name).sort()).toEqual(DEFAULT_ROLES.map((r) => r.name).sort());

      const owner = roleRows.find((r) => r.name === "Owner")!;
      const ownerPerms = await tx.select().from(rolePermissions).where(eq(rolePermissions.roleId, owner.id));
      expect(ownerPerms).toHaveLength(PERMISSION_KEYS.length);

      const cashier = roleRows.find((r) => r.name === "Cashier")!;
      const [discount] = await tx
        .select()
        .from(rolePermissions)
        .where(and(eq(rolePermissions.roleId, cashier.id), eq(rolePermissions.permissionKey, "pos.discount.apply")));
      expect(discount.limitValue).toBe("10.0000");

      const [u] = await tx.select().from(user).where(eq(user.email, "owner@example.com"));
      const [p] = await tx.select().from(profiles).where(eq(profiles.userId, u.id));
      expect(p.isActive).toBe(true);
      const [acc] = await tx.select().from(account).where(eq(account.userId, u.id));
      expect(acc.providerId).toBe("credential");
      expect(await verifyPassword({ hash: acc.password!, password: "owner-pass-123" })).toBe(true);

      const [b] = await tx.select().from(branches);
      expect(b.code).toBe("B1");
      const [ubr] = await tx.select().from(userBranchRoles).where(eq(userBranchRoles.userId, u.id));
      expect(ubr).toMatchObject({ branchId: b.id, roleId: owner.id });
    });
  });

  it("can run twice without duplicating anything", async () => {
    await withRollback(async (tx) => {
      await seedDatabase(tx, input);
      await seedDatabase(tx, { ...input, owner: { ...input.owner, password: "different-999" } });

      expect((await tx.select({ n: count() }).from(organizations))[0].n).toBe(1);
      expect((await tx.select({ n: count() }).from(roles))[0].n).toBe(DEFAULT_ROLES.length);
      expect((await tx.select({ n: count() }).from(user))[0].n).toBe(1);
      expect((await tx.select({ n: count() }).from(userBranchRoles))[0].n).toBe(1);
      // An existing owner's password is never overwritten by a re-seed.
      const [acc] = await tx.select().from(account);
      expect(await verifyPassword({ hash: acc.password!, password: "owner-pass-123" })).toBe(true);
    });
  });

  it("gives the locked Owner role any permission key added later", async () => {
    await withRollback(async (tx) => {
      await seedDatabase(tx, input);
      const [owner] = await tx.select().from(roles).where(eq(roles.name, "Owner"));
      // Simulate a permission that didn't exist when the Owner role was created.
      await tx.delete(rolePermissions).where(and(eq(rolePermissions.roleId, owner.id), eq(rolePermissions.permissionKey, "purchasing.direct")));
      await seedDatabase(tx, input);
      const keys = (await tx.select().from(rolePermissions).where(eq(rolePermissions.roleId, owner.id))).map((p) => p.permissionKey);
      expect(keys).toContain("purchasing.direct");
      expect(keys).toHaveLength(PERMISSION_KEYS.length);
    });
  });
});
