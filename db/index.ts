import { createDb } from "./client";

// One connection pool per server process. In development, Next.js reloads
// modules on every change, so the pool is kept on globalThis to avoid leaking
// connections.
const globalForDb = globalThis as unknown as {
  __cafePosDb?: ReturnType<typeof createDb>;
};

function getClient() {
  if (!globalForDb.__cafePosDb) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
    }
    globalForDb.__cafePosDb = createDb(url);
  }
  return globalForDb.__cafePosDb;
}

/** Shared Drizzle client for the app. Created on first use. */
export const db = new Proxy({} as ReturnType<typeof createDb>["db"], {
  get(_target, prop, receiver) {
    return Reflect.get(getClient().db, prop, receiver);
  },
});

/** Raw postgres.js client, for health checks and shutdown. */
export function getSql() {
  return getClient().sql;
}

export type { Database, Executor, Tx } from "./client";
