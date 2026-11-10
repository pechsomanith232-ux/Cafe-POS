import { afterAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/permissions";
import { listAudit, listBranches, listRoles, listUsers } from "@/lib/queries/settings";
import { writeAudit } from "@/lib/services/audit";
import { closeTestDb, withRollback } from "./helpers/db";
import { createWorld } from "./helpers/fixtures";

afterAll(closeTestDb);

describe("settings queries are branch-scoped", () => {
  it("lists only users who work at the viewer's branches", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = await w.ctxFor(w.users.owner); // B1 only
      const ids = (await listUsers(ctx)).map((u) => u.userId);
      expect(ids).toContain(w.users.cashier);
      expect(ids).toContain(w.users.mixed);
      expect(ids).not.toContain(w.users.b2user);
      const mixed = (await listUsers(ctx)).find((u) => u.userId === w.users.mixed)!;
      // Only the viewer's branches are shown for each user.
      expect(mixed.assignments.map((a) => a.branchId)).toEqual([w.b1.id]);
    });
  });

  it("requires users.manage to list users", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      await expect(listUsers(await w.ctxFor(w.users.cashier))).rejects.toThrow(ForbiddenError);
    });
  });

  it("lists branches the viewer belongs to, and roles with permissions", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const ctx = await w.ctxFor(w.users.owner);
      expect((await listBranches(ctx)).map((b) => b.code)).toEqual(["B1"]);
      const cashier = (await listRoles(ctx)).find((r) => r.name === "Cashier")!;
      expect(cashier.permissions["pos.discount.apply"]).toBe("10.0000");
    });
  });

  it("shows audit entries for the viewer's branches and org-wide ones, not other branches", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      const b2ctx = await w.ctxFor(w.users.b2user);
      const ownerCtx = await w.ctxFor(w.users.owner);
      await writeAudit(tx, b2ctx, { action: "secret.b2", entity: "x", branchId: w.b2.id });
      await writeAudit(tx, ownerCtx, { action: "visible.b1", entity: "x", branchId: w.b1.id });
      await writeAudit(tx, ownerCtx, { action: "visible.org", entity: "x" });
      const actions = (await listAudit(ownerCtx, {})).rows.map((r) => r.action);
      expect(actions).toEqual(expect.arrayContaining(["visible.b1", "visible.org"]));
      expect(actions).not.toContain("secret.b2");
    });
  });

  it("requires audit.view", async () => {
    await withRollback(async (tx) => {
      const w = await createWorld(tx);
      await expect(listAudit(await w.ctxFor(w.users.cashier), {})).rejects.toThrow(ForbiddenError);
    });
  });
});
