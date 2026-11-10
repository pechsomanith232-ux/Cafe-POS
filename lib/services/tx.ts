import type { Tx } from "@/db/client";
import type { AppContext } from "@/lib/permissions";

/**
 * Run a service body in ONE transaction (plan §2.1). The callback gets the
 * transaction and a context whose `db` is that transaction, so nested
 * service calls join it (as a savepoint).
 */
export function inTransaction<T>(
  ctx: AppContext,
  fn: (tx: Tx, ctx: AppContext) => Promise<T>,
): Promise<T> {
  return ctx.db.transaction((tx) => fn(tx, { ...ctx, db: tx }));
}
