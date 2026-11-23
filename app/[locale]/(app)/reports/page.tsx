import { ChevronRight, Package, ReceiptText, ShieldCheck, TrendingUp, Truck, Users, type LucideIcon } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { getContext } from "@/lib/context";
import { hasPermission, type AppContext } from "@/lib/permissions";
import type { PermissionKey } from "@/lib/permissions-catalog";
import type { Locale } from "next-intl";
import { setRequestLocale } from "next-intl/server";

export const metadata = { title: "Reports · Café POS" };

type Entry = { href: string; title: string; text: string; perm: PermissionKey };
type Group = { label: string; items: Entry[] };

/** Icon + tinted chip per group (theme tokens only): sales = brand, profit = success, inventory = info. */
const GROUP_STYLE: Record<string, { icon: LucideIcon; chip: string }> = {
  Sales: { icon: ReceiptText, chip: "bg-primary/10 text-primary" },
  Profit: { icon: TrendingUp, chip: "bg-success/10 text-success" },
  Inventory: { icon: Package, chip: "bg-info/10 text-info" },
  Purchasing: { icon: Truck, chip: "bg-chart-2/15 text-chart-2" },
  Customers: { icon: Users, chip: "bg-chart-4/10 text-chart-4" },
  Audit: { icon: ShieldCheck, chip: "bg-muted text-muted-foreground" },
};

const GROUPS: Group[] = [
  { label: "Sales", items: [
    { href: "/reports/sales", title: "Sales summary", text: "Gross, discounts, refunds, net, tax, orders and average ticket by day and hour.", perm: "reports.sales" },
    { href: "/reports/sales-by-item", title: "Sales by product", text: "By product, category, variant or modifier, with share of sales.", perm: "reports.sales" },
    { href: "/reports/payments", title: "Payments & currency", text: "Takings by method and currency; riel vs dollar cash.", perm: "reports.sales" },
    { href: "/reports/staff", title: "Sales by staff", text: "Orders, voids and refunds per staff member.", perm: "reports.sales" },
    { href: "/reports/shifts", title: "Shift reports", text: "Every shift with its X/Z report.", perm: "reports.sales" },
    { href: "/reports/void-refund", title: "Void & refund log", text: "Who voided or refunded, who approved, and why.", perm: "reports.sales" },
  ] },
  { label: "Profit", items: [
    { href: "/reports/profit", title: "Profit / COGS", text: "Net sales − cost of goods from the stock ledger, by product and category.", perm: "reports.profit" },
    { href: "/reports/branches", title: "Branch comparison", text: "Sales and profit side by side for every branch.", perm: "reports.all_branches" },
  ] },
  { label: "Inventory", items: [
    { href: "/reports/stock-valuation", title: "Stock on hand & value", text: "Quantity × average cost, as of any date.", perm: "reports.inventory" },
    { href: "/inventory/movements", title: "Stock movement history", text: "Every movement with a running balance.", perm: "inventory.view" },
    { href: "/reports/reorder", title: "Low stock & reorder", text: "Items at or below their reorder level, with a suggested order.", perm: "reports.inventory" },
    { href: "/reports/waste", title: "Waste & adjustments", text: "Stock written off, by reason and value.", perm: "reports.inventory" },
    { href: "/reports/usage", title: "Theoretical vs actual usage", text: "Recipe usage against what counts and adjustments say was used.", perm: "reports.inventory" },
  ] },
  { label: "Purchasing", items: [
    { href: "/reports/ap-aging", title: "AP aging", text: "What you owe suppliers by age, down to each invoice.", perm: "reports.ap" },
    { href: "/reports/supplier-statement", title: "Supplier statement", text: "Invoices, payments and running balance for a supplier.", perm: "reports.ap" },
    { href: "/reports/direct-purchases", title: "Direct purchases", text: "Pay-now purchases, how they were paid, and drawer pay-outs.", perm: "reports.ap" },
  ] },
  { label: "Customers", items: [
    { href: "/customers/aging", title: "AR aging", text: "What customers owe on account, by age.", perm: "reports.ar" },
    { href: "/reports/customer-statement", title: "Customer statement", text: "Charges, payments and running balance for a customer.", perm: "reports.ar" },
  ] },
  { label: "Audit", items: [
    { href: "/audit", title: "Audit log", text: "Every sensitive action: who, what, when.", perm: "audit.view" as PermissionKey },
  ] },
];

// AR and audit pages check the active branch only; the rest accept any branch the user holds the permission at.
const ACTIVE_ONLY: string[] = ["reports.ar", "audit.view", "reports.all_branches"];
const canSee = (ctx: AppContext, p: PermissionKey) =>
  ACTIVE_ONLY.includes(p) ? hasPermission(ctx, ctx.branchId, p) : ctx.branchIds.some((b) => hasPermission(ctx, b, p));

export default async function ReportsPage({ params }: PageProps<"/[locale]/reports">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale); // validated by app/[locale]/layout.tsx
  const ctx = await getContext();
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => canSee(ctx, i.perm)) })).filter((g) => g.items.length);
  if (!groups.length) return <AccessDenied permission="reports.sales" />;
  return (
    <>
      <PageHeader title="Reports" description="Every report filters by branch and dates, exports to CSV and prints." />
      <div className="grid gap-6">
        {groups.map((g) => (
          <section key={g.label}>
            <h2 className="mb-3 text-sm font-semibold text-foreground">{g.label}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((i) => {
                const { icon: Icon, chip } = GROUP_STYLE[g.label];
                return (
                  <Link key={i.href} href={i.href}
                    className="group flex items-start gap-3 rounded-lg border bg-card p-4 text-card-foreground shadow-sm transition hover:border-primary hover:shadow-md">
                    <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${chip}`}><Icon className="size-4.5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{i.title}</span>
                      <span className="block text-sm text-muted-foreground">{i.text}</span>
                    </span>
                    <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary rtl:rotate-180" />
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
