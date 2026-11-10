import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { createdAt, id, updatedAt } from "./columns";

// Organization, branches, users' profiles and access control (plan §5.1).

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  baseCurrencyCode: text("base_currency_code").notNull().default("USD"),
  settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const branches = pgTable(
  "branches",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    address: text("address"),
    phone: text("phone"),
    receiptHeader: text("receipt_header"),
    receiptFooter: text("receipt_footer"),
    taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    taxInclusive: boolean("tax_inclusive").notNull().default(true),
    settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("branches_org_code_uq").on(t.orgId, t.code)],
);

export const profiles = pgTable("profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  fullName: text("full_name").notNull(),
  pinHash: text("pin_hash"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const roles = pgTable(
  "roles",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("roles_org_name_uq").on(t.orgId, t.name)],
);

export const permissions = pgTable("permissions", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => permissions.key),
    limitValue: numeric("limit_value", { precision: 18, scale: 4 }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

/** A user's role at one branch. One role per user per branch. */
export const userBranchRoles = pgTable(
  "user_branch_roles",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("user_branch_roles_user_branch_uq").on(t.userId, t.branchId),
    index("user_branch_roles_branch_idx").on(t.branchId),
  ],
);

/** Manager PIN attempts, for rate limiting (plan §5.8: 5 failures / 5 min). */
export const pinAttempts = pgTable(
  "pin_attempts",
  {
    id: id(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    approverUserId: text("approver_user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    branchId: uuid("branch_id").references(() => branches.id),
    success: boolean("success").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("pin_attempts_actor_idx").on(t.actorUserId, t.createdAt),
    index("pin_attempts_approver_idx").on(t.approverUserId, t.createdAt),
  ],
);
