// Permission keys (plan §5.10, plus `purchasing.direct` from §4.9) and the
// default role mapping used by `db/seed.ts`. Admins can change role
// permissions later in Settings → Roles.

export const PERMISSIONS = {
  "pos.sell": "Sell at the POS",
  "pos.hold": "Hold and resume bills",
  "pos.discount.apply": "Apply discounts (up to the role limit, %)",
  "pos.discount.override": "Approve discounts above the limit (manager PIN)",
  "pos.void": "Void unpaid orders (manager PIN)",
  "pos.refund": "Refund paid orders (manager PIN)",
  "pos.price_override": "Change a line price at the POS",
  "pos.charge_account": "Charge orders to a customer account",
  "shift.open": "Open a shift",
  "shift.close": "Close a shift",
  "shift.cash_movement": "Cash pay-in / pay-out",
  "shift.close_variance_override": "Approve a shift cash variance (manager PIN)",
  "inventory.view": "View stock",
  "inventory.manage_items": "Create and edit inventory items",
  "inventory.adjust": "Post stock adjustments",
  "inventory.count": "Post stock counts",
  "inventory.transfer": "Send and receive stock transfers",
  "inventory.view_cost": "See costs and stock value",
  "menu.view": "View the menu",
  "menu.manage": "Edit products, prices and recipes",
  "purchasing.view": "View suppliers and receipts",
  "purchasing.receive": "Post goods receipts (supplier credit)",
  "purchasing.direct": "Record direct (pay-now) purchases",
  "purchasing.pay": "Record supplier payments",
  "customers.manage": "Manage customers",
  "ar.receive_payment": "Receive customer payments",
  "reports.sales": "Sales reports",
  "reports.profit": "Profit / COGS reports",
  "reports.inventory": "Inventory reports",
  "reports.ap": "Accounts payable reports",
  "reports.ar": "Accounts receivable reports",
  "reports.all_branches": "Report on all branches",
  "settings.manage": "Manage branches and settings",
  "users.manage": "Manage users and their branch roles",
  "roles.manage": "Manage roles and permissions",
  "audit.view": "View the audit log",
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

/** Permissions whose role mapping carries a numeric limit. */
export const PERMISSIONS_WITH_LIMIT: readonly PermissionKey[] = ["pos.discount.apply"];

export type RoleSeed = {
  name: string;
  isSystem: boolean;
  /** Permission keys, with an optional limit (e.g. max discount %). */
  permissions: Partial<Record<PermissionKey, number | null>>;
};

const all = (limits: Partial<Record<PermissionKey, number>> = {}) =>
  Object.fromEntries(PERMISSION_KEYS.map((k) => [k, limits[k] ?? null])) as Record<
    PermissionKey,
    number | null
  >;

const pick = (keys: PermissionKey[], limits: Partial<Record<PermissionKey, number>> = {}) =>
  Object.fromEntries(keys.map((k) => [k, limits[k] ?? null])) as Partial<
    Record<PermissionKey, number | null>
  >;

export const OWNER_ROLE = "Owner";

export const DEFAULT_ROLES: RoleSeed[] = [
  { name: OWNER_ROLE, isSystem: true, permissions: all({ "pos.discount.apply": 100 }) },
  { name: "Admin", isSystem: true, permissions: all({ "pos.discount.apply": 100 }) },
  {
    name: "Manager",
    isSystem: true,
    permissions: pick(
      [
        "pos.sell", "pos.hold", "pos.discount.apply", "pos.discount.override", "pos.void",
        "pos.refund", "pos.price_override", "pos.charge_account",
        "shift.open", "shift.close", "shift.cash_movement", "shift.close_variance_override",
        "inventory.view", "inventory.manage_items", "inventory.adjust", "inventory.count",
        "inventory.transfer", "inventory.view_cost",
        "menu.view", "menu.manage",
        "purchasing.view", "purchasing.receive", "purchasing.direct", "purchasing.pay",
        "customers.manage", "ar.receive_payment",
        "reports.sales", "reports.profit", "reports.inventory", "reports.ap", "reports.ar",
        "audit.view",
      ],
      { "pos.discount.apply": 50 },
    ),
  },
  {
    name: "Cashier",
    isSystem: true,
    permissions: pick(
      [
        "pos.sell", "pos.hold", "pos.discount.apply",
        "shift.open", "shift.close", "shift.cash_movement",
        "menu.view", "inventory.view",
      ],
      { "pos.discount.apply": 10 },
    ),
  },
  {
    name: "Barista/Kitchen",
    isSystem: true,
    permissions: pick(["pos.sell", "pos.hold", "menu.view", "inventory.view"]),
  },
  {
    name: "Stock Keeper",
    isSystem: true,
    permissions: pick([
      "inventory.view", "inventory.manage_items", "inventory.adjust", "inventory.count",
      "inventory.transfer", "inventory.view_cost",
      "purchasing.view", "purchasing.receive", "purchasing.direct",
      "menu.view", "reports.inventory",
    ]),
  },
  {
    name: "Accountant",
    isSystem: true,
    permissions: pick([
      "purchasing.view", "purchasing.pay", "customers.manage", "ar.receive_payment",
      "inventory.view", "inventory.view_cost",
      "reports.sales", "reports.profit", "reports.inventory", "reports.ap", "reports.ar",
      "reports.all_branches", "audit.view",
    ]),
  },
];
