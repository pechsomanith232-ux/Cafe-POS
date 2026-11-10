import { BranchBars } from "@/components/reports/branch-bars";
import { ReportFilters } from "@/components/reports/report-filters";
import { ReportHeader, fmtRange } from "@/components/reports/report-header";
import { ReportTable } from "@/components/reports/report-table";
import { AccessDenied } from "@/components/shared/access-denied";
import { getContext } from "@/lib/context";
import { hasPermission } from "@/lib/permissions";
import { branchComparison } from "@/lib/queries/reports/sales";
import { filterProps, readReportFilter } from "@/lib/reports/filters";

export const metadata = { title: "Branch comparison · Café POS" };

export default async function BranchComparisonPage({ searchParams }: PageProps<"/reports/branches">) {
  const ctx = await getContext();
  if (!hasPermission(ctx, ctx.branchId, "reports.all_branches")) return <AccessDenied permission="reports.all_branches" />;
  const f = readReportFilter(ctx, await searchParams, "reports.profit");
  if (!f.branches.length) return <AccessDenied permission="reports.profit" />;
  const rows = await branchComparison(ctx, { ...f, branch: "all" });
  return (
    <>
      <ReportHeader title="Branch comparison" scope={`All branches · ${fmtRange(f.from, f.to)}`} description="Net sales are after refunds and exclude tax; COGS comes from the stock ledger." />
      <ReportFilters {...filterProps(f)} branches={[]} canAll={false} />
      <div className="mb-6 grid gap-6 rounded-lg border bg-card p-4 md:grid-cols-2">
        <BranchBars title="Net sales" rows={rows.map((r) => ({ branch: r.branch, value: r.netSales }))} />
        <BranchBars title="Gross profit" rows={rows.map((r) => ({ branch: r.branch, value: r.grossProfit }))} />
      </div>
      <ReportTable filename={`branch-comparison-${f.from}-${f.to}.csv`} data={rows} columns={[
        { key: "branch", header: "Branch" }, { key: "orders", header: "Orders", kind: "int" },
        { key: "netSales", header: "Net sales", kind: "money" }, { key: "avgTicket", header: "Avg ticket", kind: "money" },
        { key: "cogs", header: "COGS", kind: "money" }, { key: "grossProfit", header: "Gross profit", kind: "money" }, { key: "marginPct", header: "Margin", kind: "pct" },
      ]} />
    </>
  );
}
