import { Link } from "@/i18n/navigation";
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
import type { Metadata } from "next";
import type { Locale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "Metadata" });
  return { title: t("dashboard") };
}

export default async function DashboardPage({ params }: PageProps<"/[locale]/dashboard">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale); // validated by app/[locale]/layout.tsx
  const t = await getTranslations("Dashboard");
  const ctx = await getContext();
  const branch = ctx.access.get(ctx.branchId)!;
  const low = hasPermission(ctx, ctx.branchId, "inventory.view") ? await lowStock(ctx, ctx.branchId) : null;
  const d = hasPermission(ctx, ctx.branchId, "reports.sales") ? await dashboard(ctx, ctx.branchId) : null;
  return (
    <>
      <PageHeader title={t("hello", { name: ctx.userName })} description={`${branch.branchCode} · ${branch.branchName} — ${branch.roleName}`} />
      {d && (
        <>
          <StatTiles tiles={[
            { label: t("tiles.netSales"), value: usd(d.today.netSales), note: t("tiles.netSalesNote") },
            { label: t("tiles.orders"), value: d.today.orders.toLocaleString("en-US") },
            { label: t("tiles.avgTicket"), value: usd(d.today.avgTicket) },
            { label: t("tiles.openShifts"), value: String(d.openShifts.length) },
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
              <CardTitle>{t("topProducts.title")}</CardTitle>
              <CardDescription>{t("topProducts.description")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {d.topProducts.map((p, i) => (
                <div key={i} className="flex justify-between"><span>{p.label} <span className="text-muted-foreground">× {p.qty}</span></span><span className="tabular-nums">{usd(p.netSales)}</span></div>
              ))}
              {d.topProducts.length === 0 && <p className="text-muted-foreground">{t("topProducts.empty")}</p>}
              <Link href="/reports/sales-by-item" className="font-medium underline">{t("topProducts.link")}</Link>
            </CardContent>
          </Card>
        )}
        {d && (
          <Card>
            <CardHeader>
              <CardTitle>{t("openShifts.title")}</CardTitle>
              <CardDescription>{t("openShifts.description")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {d.openShifts.map((s) => (
                <Link key={s.id} href={`/pos/shift/${s.id}/report`} className="flex justify-between hover:underline">
                  <span>{s.register} · {s.openedBy ?? "—"}</span><span className="text-muted-foreground">{t("openShifts.since", { time: fmtDateTime(new Date(s.openedAt)) })}</span>
                </Link>
              ))}
              {d.openShifts.length === 0 && <p className="text-muted-foreground">{t("openShifts.empty")}</p>}
            </CardContent>
          </Card>
        )}
        {low && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {t("lowStock.title")} {low.count > 0 && <Badge variant="destructive">{low.count}</Badge>}
              </CardTitle>
              <CardDescription>{t("lowStock.description")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {low.items.slice(0, 6).map((i) => (
                <Link key={i.itemId} href={`/inventory/items/${i.itemId}`} className="flex justify-between hover:underline">
                  <span>{i.name}</span>
                  <span className="text-muted-foreground">{num(i.qtyOnHand)} / {num(i.reorderLevel)} {i.baseUnit}</span>
                </Link>
              ))}
              {low.count === 0 && <p className="text-muted-foreground">{t("lowStock.empty")}</p>}
              {low.count > 0 && <Link href="/reports/reorder" className="font-medium underline">{t("lowStock.link")}</Link>}
            </CardContent>
          </Card>
        )}
        {!d && !low && (
          <Card>
            <CardHeader>
              <CardTitle>{t("welcome.title")}</CardTitle>
              <CardDescription>{t("welcome.description")}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {t.rich("welcome.tip", { b: (chunks) => <span className="font-medium text-foreground">{chunks}</span> })}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
