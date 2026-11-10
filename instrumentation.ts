// Runs once when the server starts, before it accepts requests.
// In the production image (MIGRATE_ON_START=1, set in the Dockerfile) this
// applies pending migrations (plan §9.3).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.MIGRATE_ON_START === "1") {
    // Separate module: Node-only code must not be bundled for the Edge runtime.
    const { migrateOnStart } = await import("./db/migrate-on-start");
    await migrateOnStart();
  }
}
