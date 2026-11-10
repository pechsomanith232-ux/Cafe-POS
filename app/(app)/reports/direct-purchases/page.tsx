import { ReportFilters } from "@/components/reports/report-filters";
import { ReportHeader, fmtRange } from "@/components/reports/report-header";
import { ReportTable } from "@/components/reports/report-table";
import { StatTiles } from "@/components/reports/stat-tiles";
import { AccessDenied } from "@/components/shared/access-denied";
import { getContext } from "@/lib/context";
import { dec, toMoneyString } from "@/lib/domain/money";
import { usd } from "@/lib/format";
import { directPurchases } from "@/lib/queries/reports/purchasing";
import { filterProps, readReportFilter } from "@/lib/reports/filters";

export const metadata = { title: "Direct purchases · Café POS" };

export default async function DirectPurchasesPage({ searchParams }: PageProps<"/reports/direct-purchases">) {
  const ctx = await getContext();
  const f = readReportFilter(ctx, await searchParams, "reports.ap");
  if (!f.branches.length) return <AccessDenied permission="reports.ap" />;
  const rows = await directPurchases(ctx, f);
  const total = toMoneyString(rows.reduce((a, r) => a.plus(r.total), dec(0)));
  const drawer = toMoneyString(rows.filter((r) => r.paidFromDrawer).reduce((a, r) => a.plus(r.total), dec(0)));
  return (
    <>
      <ReportHeader title="Direct purchases" scope={`${f.branchLabel} · ${fmtRange(f.from, f.to)}`} description="Pay-now purchases by receipt date." />
      <ReportFilters {...filterProps(f)} />
      <StatTiles tiles={[{ label: "Total", value: usd(total) }, { label: "Paid from the drawer", value: usd(drawer) }, { label: "Purchases", value: String(rows.length) }]} />
      <ReportTable filename={`direct-purchases-${f.from}-${f.to}.csv`} data={rows} columns={[
        { key: "date", header: "Date" }, { key: "ref", header: "Receipt", link: { prefix: "/purchasing/receipts/", key: "id" } },
        ...(f.branch === "all" ? [{ key: "branch", header: "Branch" }] : []),
        { key: "supplier", header: "Supplier" }, { key: "total", header: "Total", kind: "money" },
        { key: "method", header: "Paid by" }, { key: "currency", header: "Currency" }, { key: "amount", header: "Amount paid", kind: "qty" },
        { key: "paidFromDrawer", header: "From drawer", kind: "bool" },
      ]} />
    </>
  );
}
