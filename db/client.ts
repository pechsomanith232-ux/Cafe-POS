import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>["db"];

/**
 * Create a Drizzle client for a connection URL.
 * postgres.js connects lazily, so creating a client never touches the network.
 * Numeric columns come back as strings: do maths with decimal.js (plan §2.5).
 */
export function createDb(url: string, options: { max?: number } = {}) {
  const sql = postgres(url, {
    max: options.max ?? 10,
    // Keep logs quiet: NOTICEs from "IF NOT EXISTS" etc. are expected.
    onnotice: () => {},
  });
  const db = drizzle(sql, { schema });
  return { db, sql };
}

/** A transaction handle, as passed to `db.transaction(async (tx) => ...)`. */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Anything that can run queries: the app db or an open transaction. */
export type Executor = Database | Tx;
