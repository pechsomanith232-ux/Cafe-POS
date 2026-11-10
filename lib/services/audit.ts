import type { Executor } from "@/db/client";
import { auditLog } from "@/db/schema";
import type { AppContext } from "@/lib/permissions";

export type AuditEntry = {
  action: string;
  entity: string;
  entityId?: string | null;
  branchId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  approvedBy?: string | null;
};

/**
 * Append an audit-log row (plan §5.7). Always call with the same transaction
 * as the change it describes, so both commit or neither does.
 */
export async function writeAudit(tx: Executor, ctx: AppContext, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    orgId: ctx.orgId,
    branchId: entry.branchId ?? null,
    userId: ctx.userId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
    approvedBy: entry.approvedBy ?? null,
    ip: ctx.ip ?? null,
  });
}
