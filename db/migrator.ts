import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client";
import { waitForDatabase } from "./wait-for-database";

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/** Apply all pending SQL migrations from `drizzle/` to the given database. */
export async function runMigrations(
  url: string,
  migrationsFolder: string = MIGRATIONS_FOLDER,
): Promise<void> {
  const { db, sql } = createDb(url, { max: 1 });
  try {
    // A freshly started PostgreSQL container may need a few seconds.
    await waitForDatabase(() => sql`select 1`);
    await migrate(db, { migrationsFolder });
  } finally {
    await sql.end();
  }
}
