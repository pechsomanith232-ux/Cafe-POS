import "dotenv/config";

/**
 * URL of the disposable integration-test database.
 * Refuses anything whose database name doesn't contain "test", because the
 * global setup drops every table in it.
 */
export function getTestDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const url = env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set. Copy .env.example to .env.");
  }
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!dbName.includes("test")) {
    throw new Error(
      `TEST_DATABASE_URL points at "${dbName}". Its name must contain "test", because integration tests wipe it.`,
    );
  }
  return url;
}
