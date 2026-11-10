// `pnpm db:seed:demo`: base seed + 2 months of demo trading (plan Phase 9).
// Local/demo databases only: run `pnpm db:reset` first.
import "dotenv/config";
import { createDb } from "./client";
import { seedDemo } from "./demo-data";
import { assertResetAllowed } from "./reset-guard";
import { seedDatabase } from "./seed-data";

async function main() {
  // Same guard as db:reset: never against production.
  assertResetAllowed(process.env);
  const ownerPassword = process.env.SEED_OWNER_PASSWORD;
  if (!process.env.SEED_OWNER_EMAIL || !ownerPassword || ownerPassword.length < 8) {
    throw new Error("Set SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD (8+ characters) in .env.");
  }
  const { db, sql } = createDb(process.env.DATABASE_URL!, { max: 1 });
  try {
    console.log(`Seeding 60 days of demo data. This takes a few minutes…`);
    await db.transaction((tx) =>
      seedDatabase(tx, {
        orgName: process.env.SEED_ORG_NAME || "My Café",
        branch: { code: process.env.SEED_BRANCH_CODE || "B1", name: process.env.SEED_BRANCH_NAME || "Main Branch" },
        owner: { email: process.env.SEED_OWNER_EMAIL!, password: ownerPassword, name: process.env.SEED_OWNER_NAME || "Owner" },
      }),
    );
    const result = await seedDemo(db, { password: process.env.DEMO_STAFF_PASSWORD || ownerPassword, pin: process.env.DEMO_MANAGER_PIN || undefined });
    console.log(`Demo data ready: ${result.orders} orders.`);
    console.log("Staff logins: manager.b1@demo.local, cashier.b1@demo.local, barista.b1@demo.local (and .b2).");
    console.log("Password: DEMO_STAFF_PASSWORD (default: the owner's). Manager PIN: DEMO_MANAGER_PIN (default 1234).");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("Demo seed failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
