import { hasPermission, type AppContext } from "./permissions";
import type { Messages } from "next-intl";
import type { PermissionKey } from "./permissions-catalog";

export type NavIcon =
  | "dashboard" | "branches" | "users" | "roles" | "audit" | "account"
  | "items" | "movements" | "adjustments" | "counts"
  | "suppliers" | "receipts" | "quickPurchase" | "payments" | "aging"
  | "products" | "modifiers" | "menuCategories" | "pos" | "kitchen" | "posSettings" | "customers" | "reports" | "transfers";

export type NavItem = {
  href: string;
  /** Message key under Nav.items. */
  key: keyof Messages["Nav"]["items"];
  icon: NavIcon;
  /** Shown if the user has ANY of these at the active branch. Omit = everyone. */
  anyOf?: PermissionKey[];
  /** Show the live low-stock count next to this link. */
  badge?: "lowStock";
};

/** `key` is the message key under Nav.groups. */
export type NavGroup = { key: keyof Messages["Nav"]["groups"]; items: NavItem[] };

// Later phases add POS, inventory, menu, purchasing and reports here.
export const NAV: NavGroup[] = [
  {
    key: "overview",
    items: [
      { href: "/dashboard", key: "dashboard", icon: "dashboard" },
      { href: "/reports", key: "reports", icon: "reports", anyOf: ["reports.sales", "reports.profit", "reports.inventory", "reports.ap", "reports.ar", "audit.view"] },
    ],
  },
  {
    key: "sales",
    items: [
      { href: "/pos", key: "pos", icon: "pos", anyOf: ["pos.sell"] },
      { href: "/kitchen", key: "kitchen", icon: "kitchen", anyOf: ["pos.sell"] },
      { href: "/customers", key: "customers", icon: "customers", anyOf: ["customers.manage", "ar.receive_payment"] },
    ],
  },
  {
    key: "inventory",
    items: [
      { href: "/inventory/items", key: "items", icon: "items", anyOf: ["inventory.view"], badge: "lowStock" },
      { href: "/inventory/movements", key: "movements", icon: "movements", anyOf: ["inventory.view"] },
      { href: "/inventory/adjustments", key: "adjustments", icon: "adjustments", anyOf: ["inventory.adjust"] },
      { href: "/inventory/transfers", key: "transfers", icon: "transfers", anyOf: ["inventory.transfer"] },
      { href: "/inventory/counts", key: "counts", icon: "counts", anyOf: ["inventory.count"] },
    ],
  },
  {
    key: "menu",
    items: [
      { href: "/menu/products", key: "products", icon: "products", anyOf: ["menu.view", "menu.manage"] },
      { href: "/menu/modifiers", key: "modifiers", icon: "modifiers", anyOf: ["menu.view", "menu.manage"] },
      { href: "/menu/categories", key: "menuCategories", icon: "menuCategories", anyOf: ["menu.view", "menu.manage"] },
    ],
  },
  {
    key: "purchasing",
    items: [
      { href: "/purchasing/receipts/new?type=direct", key: "quickPurchase", icon: "quickPurchase", anyOf: ["purchasing.direct"] },
      { href: "/purchasing/receipts", key: "receipts", icon: "receipts", anyOf: ["purchasing.view"] },
      { href: "/purchasing/suppliers", key: "suppliers", icon: "suppliers", anyOf: ["purchasing.view"] },
      { href: "/purchasing/payments", key: "payments", icon: "payments", anyOf: ["purchasing.pay"] },
      { href: "/purchasing/aging", key: "aging", icon: "aging", anyOf: ["reports.ap"] },
    ],
  },
  {
    key: "settings",
    items: [
      { href: "/settings/branches", key: "branches", icon: "branches", anyOf: ["settings.manage"] },
      { href: "/settings/pos", key: "posSettings", icon: "posSettings", anyOf: ["settings.manage"] },
      { href: "/settings/users", key: "users", icon: "users", anyOf: ["users.manage"] },
      { href: "/settings/roles", key: "roles", icon: "roles", anyOf: ["roles.manage"] },
      { href: "/audit", key: "audit", icon: "audit", anyOf: ["audit.view"] },
    ],
  },
  {
    key: "you",
    items: [{ href: "/account", key: "account", icon: "account" }],
  },
];

/**
 * Sidebar links the user may see at the active branch. This only hides links:
 * every page and action checks permissions again on the server.
 */
export function visibleNav(ctx: AppContext, opts: { kitchenEnabled?: boolean } = {}): NavGroup[] {
  return NAV.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => (opts.kitchenEnabled !== false || item.href !== "/kitchen") && (!item.anyOf || item.anyOf.some((p) => hasPermission(ctx, ctx.branchId, p))),
    ),
  })).filter((group) => group.items.length > 0);
}
