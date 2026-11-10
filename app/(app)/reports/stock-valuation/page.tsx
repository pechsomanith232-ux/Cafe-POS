import { ReportFilters } from "@/components/reports/report-filters";
import { ReportHeader } from "@/components/reports/report-header";
import { ReportTable } from "@/components/reports/report-table";
import { StatTiles } from "@/components/reports/stat-tiles";
import { AccessDenied } from "@/components/shared/access-denied";
import { getContext } from "@/lib/context";
import { usd } from "@/lib/format";
import { stockValuation, type ValuationUnit } from "@/lib/queries/reports/inventory";
import { asOfParam, filterProps, readReportFilter, str } from "@/lib/reports/filters";

export const metadata = { title: "Stock valuation · Café POS" };
const UNITS: Record<ValuationUnit, string> = { base: "Base unit", purchase: "Purchase unit", count: "Count unit" };

export default async function StockValuationPage({ searchParams }: PageProps<"/reports/stock-valuation">) {
  const ctx = await getContext();
  const sp = await searchParams;
  const f = readReportFilter(ctx, sp, "reports.inventory");
  if (!f.branches.length) return <AccessDenied permission="reports.inventory" />;
  const asOf = asOfParam(sp.asOf, f.today);
  const unit = (Object.keys(UNITS) as ValuationUnit[]).find((u) => u === str(sp.unit)) ?? "base";
  const v = await stockValuation(ctx, { branch: f.branch, asOf, unit });
  return (
    <>
      <ReportHeader title="Stock on hand & value" scope={`${f.branchLabel} · as of ${asOf}`} description="Quantity and average cost at the end of the chosen day." />
      <ReportFilters {...filterProps(f)} dates="asOf" asOf={asOf}
        selects={[{ name: "unit", label: "Show quantities in", value: unit, options: Object.entries(UNITS).map(([value, label]) => ({ value, label })) }]} />
      <StatTiles tiles={[{ label: "Stock value", value: usd(v.total) }, { label: "Items in stock", value: String(v.rows.length) }]} />
      <ReportTable filename={`stock-valuation-${asOf}.csv`} data={v.rows} columns={[
        ...(f.branch === "all" ? [{ key: "branch", header: "Branch" }] : []),
        { key: "item", header: "Item" }, { key: "category", header: "Category" },
        { key: "qty", header: "On hand", kind: "qty" }, { key: "unit", header: "Unit" },
        { key: "avgCost", header: "Avg cost", kind: "unitCost" }, { key: "value", header: "Value", kind: "money" },
      ]} />
    </>
  );
}
