import { defineConfig } from "vitest/config";

// Two projects (plan §8):
//   pnpm test      -> unit tests: pure functions, no database
//   pnpm test:int  -> integration tests against TEST_DATABASE_URL, migrated fresh
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts", "lib/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          // Points the app's shared `@/db` client at the test database, so no
          // integration test can ever touch the development database.
          setupFiles: ["tests/integration/setup-env.ts"],
          // One shared test database: run files one at a time so they don't
          // interfere. Each test still rolls back its own changes.
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
