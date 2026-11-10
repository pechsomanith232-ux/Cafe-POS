import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { auditLog, roles, user, userBranchRoles } from "@/db/schema";
import { ValidationError } from "@/lib/errors";
import { ForbiddenError } from "@/lib/permissions";
import { listAudit, listUsers } from "@/lib/queries/settings";
import { writeAudit } from "@/lib/services/audit";
import { createRole, deleteRole, updateRole } from "@/lib/services/roles";
import {
  assignBranchRole,
  removeBranchRole,
  setUserActive,
  setUserPassword,
  setUserPin,
  updateUserName,
} from "@/lib/services/users";
import { closeTestDb, withRollback, type TestTx } from "./helpers/db";
import { createWorld } from "./helpers/fixtures";

afterAll(closeTestDb);

/** A "Supervisor" (users.manage + Cashier perms) at B1, held by the cashier fixture user. */
async function withSupervisor(tx: TestTx) {
  const w = await createWorld(tx);
  const ownerCtx = await w.ctxFor(w.users.owner);
  const sup = await createRole(ownerCtx, {
    name: "Supervisor",
    permissions: [{ key: "users.manage" }, { key: "pos.sell" }, { key: "pos.hold" }, { key: "pos.discount.apply", limit: "10" },
      { key: "shift.open" }, { key: "shift.close" }, { key: "shift.cash_movement" }, { key: "menu.view" }, { key: "inventory.view" }],
  });
  await assignBranchRole(ownerCtx, { userId: w.users.cashier, branchId: w.b1.id, roleId: sup.id });
  return { ...w, ownerCtx, supRoleId: sup.id, supCtx: await w.ctxFor(w.users.cashier) };
}

describe("review #1: users.manage can't take over a more powerful account", () => {
  it("adding an Admin from another branch as Cashier doesn't let you reset their password, PIN, name or status", async () => {
    await withRollback(async (tx) => {
      const w = await withSupervisor(tx);
      // b2user is Manager at B2. The supervisor adds them to B1 as Cashier (allowed)…
      const cashierRole = (await tx.select().from(roles).where(eq(roles.name, "Cashier")))[0].id;
      await assignBranchRole(w.supCtx, { userId: w.users.b2user, branchId: w.b1.id, roleId: cashierRole });
      // …but must not be able to take over the account.
      await expect(setUserPassword(w.supCtx, w.users.b2user, "taken-over-1")).rejects.toThrow(ForbiddenError);
      await expect(setUserPin(w.supCtx, w.users.b2user, "1234")).rejects.toThrow(ForbiddenError);
      await expect(setUserActive(w.supCtx, w.users.b2user, false)).rejects.toThrow(ForbiddenError);
      await expect(updateUserName(w.supCtx, w.users.b2user, "Pwned")).rejects.toThrow(ForbiddenError);
    });
  });

  it("still lets you manage someone whose every role you could grant", async () => {
    await withRollback(async (tx) => {
      const w = await withSupervisor(tx);
      const cashierRole = (await tx.select().from(roles).where(eq(roles.name, "Cashier")))[0].id;
      await assignBranchRole(w.ownerCtx, { userId: w.users.manager, branchId: w.b1.id, roleId: cashierRole });
      await expect(setUserPin(w.supCtx, w.users.manager, "2468")).resolves.toBeUndefined();
      await updateUserName(w.supCtx, w.users.manager, "Renamed");
      const [u] = await tx.select().from(user).where(eq(user.id, w.users.manager));
      expect(u.name).toBe("Renamed");
      expect(await tx.select().from(auditLog).where(eq(auditLog.action, "user.update"))).toHaveLength(1);
    });
  });

  it("can't set another user's PIN or remove their branch role without permission", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const mgrCtx = await w.ctxFor(w.users.manager); // Manager: no users.manage
      await expect(setUserPin(mgrCtx, w.users.cashier, "1234")).rejects.toThrow(ForbiddenError);
      await expect(removeBranchRole(mgrCtx, { userId: w.users.cashier, branchId: w.b1.id })).rejects.toThrow(ForbiddenError);
    });
  });
});

describe("review #3: roles.manage can't escalate", () => {
  async function roleEditor(tx: TestTx) {
    const w = await createWorld(tx);
    const ownerCtx = await w.ctxFor(w.users.owner);
    const editor = await createRole(ownerCtx, { name: "Role editor", permissions: [{ key: "roles.manage" }, { key: "menu.view" }] });
    await assignBranchRole(ownerCtx, { userId: w.users.cashier, branchId: w.b1.id, roleId: editor.id });
    return { ...w, ownerCtx, editorRoleId: editor.id, editorCtx: await w.ctxFor(w.users.cashier) };
  }

  it("can't add permissions to their own role", async () => {
    await withRollback(async (tx) => {
      const w = await roleEditor(tx);
      await expect(
        updateRole(w.editorCtx, w.editorRoleId, { name: "Role editor", permissions: [{ key: "roles.manage" }, { key: "users.manage" }] }),
      ).rejects.toThrow(/own role|ForbiddenError/);
    });
  });

  it("can't create a role with permissions they don't have", async () => {
    await withRollback(async (tx) => {
      const w = await roleEditor(tx);
      await expect(createRole(w.editorCtx, { name: "Sneaky", permissions: [{ key: "settings.manage" }] })).rejects.toThrow(ForbiddenError);
    });
  });

  it("can't edit or strip a role more powerful than their own", async () => {
    await withRollback(async (tx) => {
      const w = await roleEditor(tx);
      const admin = (await tx.select().from(roles).where(eq(roles.name, "Admin")))[0].id;
      await expect(updateRole(w.editorCtx, admin, { name: "Admin", permissions: [] })).rejects.toThrow(ForbiddenError);
    });
  });

  it("can create, edit and delete roles within their own permissions", async () => {
    await withRollback(async (tx) => {
      const w = await roleEditor(tx);
      const r = await createRole(w.editorCtx, { name: "Viewer", permissions: [{ key: "menu.view" }] });
      await updateRole(w.editorCtx, r.id, { name: "Menu viewer", permissions: [{ key: "menu.view" }] });
      await deleteRole(w.editorCtx, r.id);
      const actions = (await tx.select().from(auditLog).where(eq(auditLog.entityId, r.id))).map((l) => l.action).sort();
      expect(actions).toEqual(["role.create", "role.delete", "role.update"]);
    });
  });

  it("won't delete a built-in role or one still in use", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = await w.ctxFor(w.users.owner);
      await expect(deleteRole(ctx, w.roleIds.cashier)).rejects.toThrow(ValidationError);
      const r = await createRole(ctx, { name: "Temp", permissions: [{ key: "pos.sell" }] });
      await assignBranchRole(ctx, { userId: w.users.cashier, branchId: w.b1.id, roleId: r.id });
      await expect(deleteRole(ctx, r.id)).rejects.toThrow(ValidationError);
    });
  });

  it("rejects prototype keys like 'constructor' as unknown permissions", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = await w.ctxFor(w.users.owner);
      await expect(createRole(ctx, { name: "Proto", permissions: [{ key: "constructor" }] })).rejects.toThrow(ValidationError);
    });
  });
});

describe("review #6: lists respect per-branch permissions", () => {
  it("audit rows only from branches where the viewer has audit.view", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const b2ctx = await w.ctxFor(w.users.b2user);
      await writeAudit(tx, b2ctx, { action: "b2.only", entity: "x", branchId: w.b2.id });
      // mixed: Manager (audit.view) at B1, Cashier (no audit.view) at B2
      const mixedCtx = await w.ctxFor(w.users.mixed, w.b1.id);
      const actions = (await listAudit(mixedCtx, {})).rows.map((r) => r.action);
      expect(actions).not.toContain("b2.only");
    });
  });

  it("users only from branches where the viewer has users.manage", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      // Give the owner a Cashier role at B2: they can see B2 but not manage users there.
      await tx.insert(userBranchRoles).values({ userId: w.users.owner, branchId: w.b2.id, roleId: w.roleIds.cashier });
      const ctx = await w.ctxFor(w.users.owner, w.b1.id);
      const list = await listUsers(ctx);
      expect(list.map((u) => u.userId)).not.toContain(w.users.b2user);
      const mixed = list.find((u) => u.userId === w.users.mixed)!;
      expect(mixed.assignments.map((a) => a.branchId)).toEqual([w.b1.id]);
    });
  });
});

void and;
