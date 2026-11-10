// `pnpm db:reset` drops every table. It must never touch production data.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function assertResetAllowed(env: {
  NODE_ENV?: string;
  DATABASE_URL?: string;
}): void {
  if (env.NODE_ENV === "production") {
    throw new Error("db:reset refused: NODE_ENV is production.");
  }
  if (!env.DATABASE_URL) {
    throw new Error("db:reset refused: DATABASE_URL is not set.");
  }
  const host = new URL(env.DATABASE_URL).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `db:reset refused: ${host} is not a local database (only localhost is allowed).`,
    );
  }
}
