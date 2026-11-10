// Fresh test database with an owner (with a manager PIN) and one product.
import { eq } from "drizzle-orm";
import { createDb } from "@/db/client";
import { branches, organizations, userBranchRoles } from "@/db/schema";
import { seedDatabase } from "@/db/seed-data";
import { buildContext } from "@/lib/context-builder";
import { createItem, setOpeningStock } from "@/lib/services/inventory";
import { saveProduct } from "@/lib/services/menu";
import { setUserPin } from "@/lib/services/users";
import resetTestDatabase from "../integration/global-setup";
import { getTestDatabaseUrl } from "../integration/test-db-url";
import { OWNER, PIN } from "./fixtures";

export default async function setup() {
  await resetTestDatabase();
  const { db, sql } = createDb(getTestDatabaseUrl(), { max: 1 });
  try {
    await db.transaction(async (tx) => {
      await seedDatabase(tx, { orgName: "E2E Café", branch: { code: "B1", name: "Main" }, owner: OWNER });
      const [org] = await tx.select().from(organizations);
      const [branch] = await tx.select().from(branches).where(eq(branches.orgId, org.id));
      const [{ userId }] = await tx.select().from(userBranchRoles).where(eq(userBranchRoles.branchId, branch.id));
      const owner = await buildContext(tx, { userId, requestedBranchId: branch.id });
      await setUserPin(owner, userId, PIN);
      const milk = await createItem(owner, { name: "Fresh Milk", baseUnitCode: "ml", units: [] });
      await setOpeningStock(owner, { branchId: branch.id, itemId: milk.id, unitKey: "base", qty: "10000", unitCost: "0.0015" });
      await saveProduct(owner, null, {
        name: "Latte", kitchenStation: "bar",
        variants: [{ name: "Regular", price: "2.50", isDefault: true, recipe: [{ itemId: milk.id, unitKey: "base", qty: "200" }] }],
      });
    });
  } finally {
    await sql.end();
  }
}
