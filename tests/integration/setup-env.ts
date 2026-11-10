// Runs in each integration test file before any test code imports `@/db`.
import { getTestDatabaseUrl } from "./test-db-url";

process.env.DATABASE_URL = getTestDatabaseUrl();
