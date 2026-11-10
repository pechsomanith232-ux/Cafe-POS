import "dotenv/config";
import { defineConfig } from "@playwright/test";
import { getTestDatabaseUrl } from "./tests/integration/test-db-url";

// `pnpm test:e2e`: runs the app against the disposable test database
// (TEST_DATABASE_URL, wiped by the global setup) with its own build folder,
// so it can run while `pnpm dev` is open.
const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL, viewport: { width: 1280, height: 800 }, trace: "retain-on-failure" },
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: `${baseURL}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: { DATABASE_URL: getTestDatabaseUrl(), BETTER_AUTH_URL: baseURL, NEXT_DIST_DIR: ".next-e2e" },
  },
});
