import { runMigrations } from "./migrator";

/** Apply pending migrations; a failure stops the container, so Coolify keeps the previous version running. */
export async function migrateOnStart() {
  const url = process.env.DATABASE_URL;
  try {
    if (!url) throw new Error("DATABASE_URL is not set.");
    await runMigrations(url);
    console.log("Migrations applied.");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}
