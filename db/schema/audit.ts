import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id } from "./columns";
import { branches, organizations } from "./org";

/**
 * Append-only audit log (plan §5.7). Written by lib/services/audit.ts inside
 * the same transaction as the change. A trigger blocks UPDATE and DELETE.
 * user_id / approved_by are plain text (no FK) so history survives anything.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id").references(() => branches.id),
    userId: text("user_id"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    approvedBy: text("approved_by"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_created_idx").on(t.createdAt),
    index("audit_log_entity_idx").on(t.entity, t.entityId),
    index("audit_log_user_idx").on(t.userId, t.createdAt),
  ],
);
