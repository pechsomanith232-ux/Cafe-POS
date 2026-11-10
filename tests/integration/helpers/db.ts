import { sql } from "drizzle-orm";
import { TransactionRollbackError } from "drizzle-orm";
import { createDb, type Database, type Tx } from "@/db/client";
import { getTestDatabaseUrl } from "../test-db-url";

const client = createDb(getTestDatabaseUrl(), { max: 5 });

/** Drizzle client connected to the test database. */
export const testDb: Database = client.db;

export type TestTx = Tx;

/**
 * Run `fn` inside a transaction that is always rolled back, so each test
 * leaves the database exactly as it found it. Code under test that opens its
 * own `tx.transaction()` gets a savepoint inside this one.
 */
export async function withRollback<T>(fn: (tx: TestTx) => Promise<T>): Promise<T> {
  let result: T;
  // Only swallow the rollback this helper raises itself. A rollback raised by
  // the code under test must fail the test.
  let harnessRollback = false;
  try {
    await testDb.transaction(async (tx) => {
      result = await fn(tx);
      harnessRollback = true;
      tx.rollback();
    });
  } catch (err) {
    if (!(harnessRollback && err instanceof TransactionRollbackError)) throw err;
  }
  return result!;
}

/** Close the pool; call from `afterAll` in each integration test file. */
export async function closeTestDb() {
  await client.sql.end();
}

/** Drizzle wraps PostgreSQL errors; return the underlying database message. */
export async function dbErrorMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    const cause = (err as { cause?: { message?: string } }).cause;
    return cause?.message ?? (err as Error).message;
  }
  throw new Error("Expected the query to fail, but it succeeded");
}

/**
 * Test-only cleanup for tests that must commit (concurrency). Runs with
 * triggers disabled so append-only rows (stock_movements) can be removed.
 */
export async function cleanupCommitted(fn: (tx: TestTx) => Promise<void>) {
  await testDb.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    await fn(tx);
  });
}
