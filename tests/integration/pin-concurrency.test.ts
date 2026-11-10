import { hash } from "@node-rs/argon2";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { branches, organizations, permissions, pinAttempts, profiles, rolePermissions, roles, user, userBranchRoles } from "@/db/schema";
import { insertAuthUser } from "@/lib/auth-users";
import { buildContext } from "@/lib/context-builder";
import { verifyManagerPin } from "@/lib/services/pin";
import { closeTestDb, testDb } from "./helpers/db";

afterAll(closeTestDb);

// Needs real parallel connections, so this test commits its own small
// fixture (no audit rows) and deletes it afterwards instead of rolling back.
describe("review #2: PIN rate limit holds under parallel attempts", () => {
  it("records at most 5 failures when 20 wrong PINs arrive at once", async () => {
    const ids = { org: "", branch: "", role: "", users: [] as string[] };
    try {
      await testDb.insert(permissions).values({ key: "pos.void", description: "Void" }).onConflictDoNothing();
      const [org] = await testDb.insert(organizations).values({ name: "Race Org" }).returning();
      ids.org = org.id;
      const [branch] = await testDb.insert(branches).values({ orgId: org.id, code: "RACE", name: "Race" }).returning();
      ids.branch = branch.id;
      const [role] = await testDb.insert(roles).values({ orgId: org.id, name: "Mgr" }).returning();
      ids.role = role.id;
      await testDb.insert(rolePermissions).values({ roleId: role.id, permissionKey: "pos.void" });
      const actor = await insertAuthUser(testDb, { orgId: org.id, email: "race-actor@test.local", name: "Actor", password: "actor-pass-1" });
      ids.users.push(actor);
      const approver = await insertAuthUser(testDb, { orgId: org.id, email: "race-mgr@test.local", name: "Mgr", password: "mgr-pass-12" });
      ids.users.push(approver);
      await testDb.update(profiles).set({ pinHash: await hash("4321") }).where(eq(profiles.userId, approver));
      await testDb.insert(userBranchRoles).values([
        { userId: actor, branchId: branch.id, roleId: role.id },
        { userId: approver, branchId: branch.id, roleId: role.id },
      ]);

      const ctx = await buildContext(testDb, { userId: actor });
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () =>
          verifyManagerPin(ctx, { branchId: branch.id, approverId: approver, pin: "0000", permission: "pos.void" }),
        ),
      );
      expect(results.every((r) => r.status === "rejected")).toBe(true);
      const failures = await testDb.select().from(pinAttempts).where(eq(pinAttempts.actorUserId, actor));
      expect(failures).toHaveLength(5);
    } finally {
      if (ids.users.length) {
        await testDb.delete(pinAttempts).where(inArray(pinAttempts.actorUserId, ids.users));
        await testDb.delete(userBranchRoles).where(inArray(userBranchRoles.userId, ids.users));
        await testDb.delete(user).where(inArray(user.id, ids.users)); // cascades to account, profiles
      }
      if (ids.role) {
        await testDb.delete(rolePermissions).where(eq(rolePermissions.roleId, ids.role));
        await testDb.delete(roles).where(eq(roles.id, ids.role));
      }
      if (ids.branch) await testDb.delete(branches).where(eq(branches.id, ids.branch));
      if (ids.org) await testDb.delete(organizations).where(eq(organizations.id, ids.org));
    }
  });
});
