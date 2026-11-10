import { ReportFilters } from "@/components/reports/report-filters";
import { ReportHeader, fmtRange } from "@/components/reports/report-header";
import { ReportTable, type ReportColumn } from "@/components/reports/report-table";
import { StatTiles } from "@/components/reports/stat-tiles";
import { AccessDenied } from "@/components/shared/access-denied";
import { getContext } from "@/lib/context";
import { usd } from "@/lib/format";
import { profitReport } from "@/lib/queries/reports/profit";
import { filterProps, readReportFilter } from "@/lib/reports/filters";

export const metadata = { title: "Profit / COGS · Café POS" };

const cols = (first: string): ReportColumn[] => [
  { key: "label", header: first },
  { key: "qty", header: "Qty", kind: "int" },
  { key: "netSales", header: "Net sales", kind: "money" },
  { key: "cogs", header: "COGS", kind: "money" },
  { key: "grossProfit", header: "Gross profit", kind: "money" },
  { key: "marginPct", header: "Margin", kind: "pct" },
  { key: "theoreticalCost", header: "Theoretical cost", kind: "money" },
];
const SOURCES: Record<string, string> = { actual: "Actual (stock deducted)", theoretical: "Theoretical (no stock deducted)", none: "No recipe" };

export default async function ProfitPage({ searchParams }: PageProps<"/reports/profit">) {
  const ctx = await getContext();
  const f = readReportFilter(ctx, await searchParams, "reports.profit");
  if (!f.branches.length) return <AccessDenied permission="reports.profit" />;
  const p = await profitReport(ctx, f);
  const t = p.totals;
  return (
    <>
      <ReportHeader title="Profit / COGS" scope={`${f.branchLabel} · ${fmtRange(f.from, f.to)}`}
        description="COGS comes from the stock ledger: sale movements minus restocked refunds. Theoretical cost is recipe cost of items that don't deduct stock — shown, but not in COGS." />
      <ReportFilters {...filterProps(f)} />
      <StatTiles tiles={[
        { label: "Net sales", value: usd(t.netSales), note: "Ex tax, less refunds" },
        { label: "COGS", value: usd(t.cogs) },
        { label: "Gross profit", value: usd(t.grossProfit) },
        { label: "Margin", value: t.marginPct === null ? "—" : `${t.marginPct}%` },
        { label: "Theoretical cost", value: usd(t.theoreticalCost), note: "Not in the stock ledger" },
      ]} />
      <h2 className="mb-2 font-medium">By product</h2>
      <ReportTable filename={`profit-by-product-${f.from}-${f.to}.csv`} data={p.byProduct} columns={cols("Product")} />
      <h2 className="mt-6 mb-2 font-medium">By category</h2>
      <ReportTable filename={`profit-by-category-${f.from}-${f.to}.csv`} data={p.byCategory} columns={cols("Category")} />
      <h2 className="mt-6 mb-2 font-medium">Cost sources</h2>
      <ReportTable filename={`cost-sources-${f.from}-${f.to}.csv`} data={p.costSources} columns={[
        { key: "source", header: "Source", labels: SOURCES }, { key: "lines", header: "Lines sold", kind: "int" }, { key: "cost", header: "Recorded cost (net of refunds)", kind: "money" },
      ]} />
    </>
  );
}
