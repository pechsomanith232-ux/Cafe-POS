import { hasPermission, type AppContext } from "./permissions";
import type { PermissionKey } from "./permissions-catalog";

export type NavIcon =
  | "dashboard" | "branches" | "users" | "roles" | "audit" | "account"
  | "items" | "movements" | "adjustments" | "counts"
  | "suppliers" | "receipts" | "quickPurchase" | "payments" | "aging"
  | "products" | "modifiers" | "menuCategories" | "pos" | "kitchen" | "posSettings" | "customers" | "reports" | "transfers";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  /** Shown if the user has ANY of these at the active branch. Omit = everyone. */
  anyOf?: PermissionKey[];
  /** Show the live low-stock count next to this link. */
  badge?: "lowStock";
};

export type NavGroup = { label: string; items: NavItem[] };

// Later phases add POS, inventory, menu, purchasing and reports here.
export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
      { href: "/reports", label: "Reports", icon: "reports", anyOf: ["reports.sales", "reports.profit", "reports.inventory", "reports.ap", "reports.ar", "audit.view"] },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/pos", label: "POS", icon: "pos", anyOf: ["pos.sell"] },
      { href: "/kitchen", label: "Kitchen screen", icon: "kitchen", anyOf: ["pos.sell"] },
      { href: "/customers", label: "Customers", icon: "customers", anyOf: ["customers.manage", "ar.receive_payment"] },
    ],
  },
  {
    label: "Inventory",
    items: [
      { href: "/inventory/items", label: "Items & stock", icon: "items", anyOf: ["inventory.view"], badge: "lowStock" },
      { href: "/inventory/movements", label: "Movements", icon: "movements", anyOf: ["inventory.view"] },
      { href: "/inventory/adjustments", label: "Adjustments", icon: "adjustments", anyOf: ["inventory.adjust"] },
      { href: "/inventory/transfers", label: "Transfers", icon: "transfers", anyOf: ["inventory.transfer"] },
      { href: "/inventory/counts", label: "Stock counts", icon: "counts", anyOf: ["inventory.count"] },
    ],
  },
  {
    label: "Menu",
    items: [
      { href: "/menu/products", label: "Products", icon: "products", anyOf: ["menu.view", "menu.manage"] },
      { href: "/menu/modifiers", label: "Modifier groups", icon: "modifiers", anyOf: ["menu.view", "menu.manage"] },
      { href: "/menu/categories", label: "Menu categories", icon: "menuCategories", anyOf: ["menu.view", "menu.manage"] },
    ],
  },
  {
    label: "Purchasing",
    items: [
      { href: "/purchasing/receipts/new?type=direct", label: "Quick purchase", icon: "quickPurchase", anyOf: ["purchasing.direct"] },
      { href: "/purchasing/receipts", label: "Goods receipts", icon: "receipts", anyOf: ["purchasing.view"] },
      { href: "/purchasing/suppliers", label: "Suppliers", icon: "suppliers", anyOf: ["purchasing.view"] },
      { href: "/purchasing/payments", label: "Supplier payments", icon: "payments", anyOf: ["purchasing.pay"] },
      { href: "/purchasing/aging", label: "AP aging", icon: "aging", anyOf: ["reports.ap"] },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/settings/branches", label: "Branches", icon: "branches", anyOf: ["settings.manage"] },
      { href: "/settings/pos", label: "POS settings", icon: "posSettings", anyOf: ["settings.manage"] },
      { href: "/settings/users", label: "Users", icon: "users", anyOf: ["users.manage"] },
      { href: "/settings/roles", label: "Roles", icon: "roles", anyOf: ["roles.manage"] },
      { href: "/audit", label: "Audit log", icon: "audit", anyOf: ["audit.view"] },
    ],
  },
  {
    label: "You",
    items: [{ href: "/account", label: "My account", icon: "account" }],
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
