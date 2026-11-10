import { ensureBranchDefaults } from "@/lib/branch-defaults";
import { and, eq } from "drizzle-orm";
import type { Executor } from "@/db/client";
import { branches, itemUnits, items, organizations, roles, units, userBranchRoles } from "@/db/schema";
import { seedDatabase } from "@/db/seed-data";
import { insertAuthUser } from "@/lib/auth-users";
import { buildContext } from "@/lib/context-builder";

/**
 * Standard test world: org seeded with default roles, branches B1 + B2,
 *   owner   — Owner at B1 (from the seed)
 *   manager — Manager at B1
 *   cashier — Cashier at B1
 *   b2user  — Manager at B2 only
 *   mixed   — Manager at B1, Cashier at B2
 */
export async function createWorld(tx: Executor) {
  await seedDatabase(tx, {
    orgName: "Test Café",
    branch: { code: "B1", name: "Main" },
    owner: { email: "owner@test.local", password: "owner-pass-1", name: "Owner" },
  });
  const [org] = await tx.select().from(organizations);
  const [b1] = await tx.select().from(branches).where(eq(branches.code, "B1"));
  const [b2] = await tx.insert(branches).values({ orgId: org.id, code: "B2", name: "Riverside" }).returning();
  await ensureBranchDefaults(tx, b2.id);

  const roleId = async (name: string) =>
    (await tx.select().from(roles).where(and(eq(roles.orgId, org.id), eq(roles.name, name))))[0].id;
  const roleIds = {
    owner: await roleId("Owner"),
    manager: await roleId("Manager"),
    cashier: await roleId("Cashier"),
  };

  async function makeUser(name: string, assignments: [string, string][]) {
    const id = await insertAuthUser(tx, {
      orgId: org.id,
      email: `${name}@test.local`,
      name,
      password: `${name}-pass-1`,
    });
    for (const [branchId, role] of assignments) {
      await tx.insert(userBranchRoles).values({ userId: id, branchId, roleId: role });
    }
    return id;
  }

  const [ownerRow] = await tx.select().from(userBranchRoles).where(eq(userBranchRoles.roleId, roleIds.owner));
  const users = {
    owner: ownerRow.userId,
    manager: await makeUser("manager", [[b1.id, roleIds.manager]]),
    cashier: await makeUser("cashier", [[b1.id, roleIds.cashier]]),
    b2user: await makeUser("b2user", [[b2.id, roleIds.manager]]),
    mixed: await makeUser("mixed", [[b1.id, roleIds.manager], [b2.id, roleIds.cashier]]),
  };

  const ctxFor = (userId: string, requestedBranchId?: string) =>
    buildContext(tx, { userId, requestedBranchId });

  return { org, b1, b2, roleIds, users, ctxFor };
}

/** An inventory item with a base unit (and optional packaging units). */
export async function createItem(
  tx: Executor,
  orgId: string,
  input: { name: string; base: "ml" | "g" | "pcs" | "L" | "kg"; packaging?: { name: string; factor: string }[] },
) {
  const [unit] = await tx.select().from(units).where(eq(units.code, input.base));
  const [item] = await tx.insert(items).values({ orgId, name: input.name, baseUnitId: unit.id }).returning();
  for (const p of input.packaging ?? []) {
    await tx.insert(itemUnits).values({ itemId: item.id, name: p.name, factorToBase: p.factor });
  }
  return item;
}
