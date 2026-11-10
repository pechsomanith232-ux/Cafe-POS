import Link from "next/link";
import { SalesTrend } from "@/components/reports/sales-trend";
import { StatTiles } from "@/components/reports/stat-tiles";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getContext } from "@/lib/context";
import { fmtDateTime, num, usd } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import { lowStock } from "@/lib/queries/inventory";
import { dashboard } from "@/lib/queries/reports/dashboard";

export const metadata = { title: "Dashboard · Café POS" };

export default async function DashboardPage() {
  const ctx = await getContext();
  const branch = ctx.access.get(ctx.branchId)!;
  const low = hasPermission(ctx, ctx.branchId, "inventory.view") ? await lowStock(ctx, ctx.branchId) : null;
  const d = hasPermission(ctx, ctx.branchId, "reports.sales") ? await dashboard(ctx, ctx.branchId) : null;
  return (
    <>
      <PageHeader title={`Hello, ${ctx.userName}`} description={`${branch.branchCode} · ${branch.branchName} — ${branch.roleName}`} />
      {d && (
        <>
          <StatTiles tiles={[
            { label: "Today's net sales", value: usd(d.today.netSales), note: "Ex tax, after refunds" },
            { label: "Orders today", value: d.today.orders.toLocaleString("en-US") },
            { label: "Average ticket", value: usd(d.today.avgTicket) },
            { label: "Open shifts", value: String(d.openShifts.length) },
          ]} />
          <Card className="mb-6">
            <CardContent className="pt-0">
              <SalesTrend series7={d.series7} series30={d.series30} />
            </CardContent>
          </Card>
        </>
      )}
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {d && (
          <Card>
            <CardHeader>
              <CardTitle>Top products today</CardTitle>
              <CardDescription>By net sales.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {d.topProducts.map((p, i) => (
                <div key={i} className="flex justify-between"><span>{p.label} <span className="text-muted-foreground">× {p.qty}</span></span><span className="tabular-nums">{usd(p.netSales)}</span></div>
              ))}
              {d.topProducts.length === 0 && <p className="text-muted-foreground">No sales yet today.</p>}
              <Link href="/reports/sales-by-item" className="font-medium underline">Sales by product</Link>
            </CardContent>
          </Card>
        )}
        {d && (
          <Card>
            <CardHeader>
              <CardTitle>Open shifts</CardTitle>
              <CardDescription>Registers taking money right now.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {d.openShifts.map((s) => (
                <Link key={s.id} href={`/pos/shift/${s.id}/report`} className="flex justify-between hover:underline">
                  <span>{s.register} · {s.openedBy ?? "—"}</span><span className="text-muted-foreground">since {fmtDateTime(new Date(s.openedAt))}</span>
                </Link>
              ))}
              {d.openShifts.length === 0 && <p className="text-muted-foreground">No shift is open.</p>}
            </CardContent>
          </Card>
        )}
        {low && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Low stock {low.count > 0 && <Badge variant="destructive">{low.count}</Badge>}
              </CardTitle>
              <CardDescription>Items at or below their reorder level at this branch.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {low.items.slice(0, 6).map((i) => (
                <Link key={i.itemId} href={`/inventory/items/${i.itemId}`} className="flex justify-between hover:underline">
                  <span>{i.name}</span>
                  <span className="text-muted-foreground">{num(i.qtyOnHand)} / {num(i.reorderLevel)} {i.baseUnit}</span>
                </Link>
              ))}
              {low.count === 0 && <p className="text-muted-foreground">Everything is above its reorder level.</p>}
              {low.count > 0 && <Link href="/reports/reorder" className="font-medium underline">Suggested reorder</Link>}
            </CardContent>
          </Card>
        )}
        {!d && !low && (
          <Card>
            <CardHeader>
              <CardTitle>Welcome</CardTitle>
              <CardDescription>Use the menu to get to your work.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Tip: set your manager PIN under <span className="font-medium text-foreground">My account</span> so you can approve voids, refunds and big discounts.
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
