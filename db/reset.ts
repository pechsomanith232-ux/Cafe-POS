// `pnpm db:reset`: drop everything, migrate, seed. Local development only.
import "dotenv/config";
import { execSync } from "node:child_process";
import postgres from "postgres";
import { runMigrations } from "./migrator";
import { assertResetAllowed } from "./reset-guard";

async function main() {
  assertResetAllowed(process.env);
  const url = process.env.DATABASE_URL!;

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(`
      DROP SCHEMA IF EXISTS drizzle CASCADE;
      DROP SCHEMA IF EXISTS public CASCADE;
      CREATE SCHEMA public;
    `);
  } finally {
    await sql.end();
  }
  console.log("Dropped all tables.");

  await runMigrations(url);
  console.log("Migrations applied.");

  execSync("pnpm db:seed", { stdio: "inherit" });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
