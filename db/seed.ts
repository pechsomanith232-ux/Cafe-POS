// `pnpm db:seed`: permissions, default roles, the first branch and the Owner.
// Safe to run more than once.
import "dotenv/config";
import { createDb } from "./client";
import { seedDatabase } from "./seed-data";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set. See .env.example.`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const owner = {
    email: required("SEED_OWNER_EMAIL"),
    password: required("SEED_OWNER_PASSWORD"),
    name: process.env.SEED_OWNER_NAME || "Owner",
  };
  if (owner.password.length < 8) {
    console.error("SEED_OWNER_PASSWORD must be at least 8 characters.");
    process.exit(1);
  }

  const { db, sql } = createDb(required("DATABASE_URL"), { max: 1 });
  try {
    await db.transaction((tx) =>
      seedDatabase(tx, {
        orgName: process.env.SEED_ORG_NAME || "My Café",
        branch: {
          code: process.env.SEED_BRANCH_CODE || "B1",
          name: process.env.SEED_BRANCH_NAME || "Main Branch",
        },
        owner,
      }),
    );
    console.log(`Seed complete. Owner login: ${owner.email}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
