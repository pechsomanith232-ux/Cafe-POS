// `pnpm db:migrate`: apply pending migrations to DATABASE_URL.
import "dotenv/config";
import { runMigrations } from "./migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.");
  process.exit(1);
}

runMigrations(url)
  .then(() => console.log("Migrations applied."))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
