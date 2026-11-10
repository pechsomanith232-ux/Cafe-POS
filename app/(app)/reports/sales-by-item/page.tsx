import { ReportFilters } from "@/components/reports/report-filters";
import { ReportHeader, fmtRange } from "@/components/reports/report-header";
import { ReportTable } from "@/components/reports/report-table";
import { AccessDenied } from "@/components/shared/access-denied";
import { getContext } from "@/lib/context";
import { salesByItem, type SalesDimension } from "@/lib/queries/reports/sales";
import { filterProps, readReportFilter, str } from "@/lib/reports/filters";

export const metadata = { title: "Sales by product · Café POS" };
const DIMS: Record<SalesDimension, string> = { product: "Product", category: "Category", variant: "Variant", modifier: "Modifier" };

export default async function SalesByItemPage({ searchParams }: PageProps<"/reports/sales-by-item">) {
  const ctx = await getContext();
  const sp = await searchParams;
  const f = readReportFilter(ctx, sp, "reports.sales");
  if (!f.branches.length) return <AccessDenied permission="reports.sales" />;
  const by = (Object.keys(DIMS) as SalesDimension[]).find((d) => d === str(sp.by)) ?? "product";
  const rows = await salesByItem(ctx, { ...f, by });
  return (
    <>
      <ReportHeader title={`Sales by ${DIMS[by].toLowerCase()}`} scope={`${f.branchLabel} · ${fmtRange(f.from, f.to)}`}
        description={by === "modifier" ? "Add-on sales: modifier price × quantity, before discounts, less refunds." : "Quantity sold and net sales (ex tax, less refunds)."} />
      <ReportFilters {...filterProps(f)} selects={[{ name: "by", label: "Group by", value: by, options: Object.entries(DIMS).map(([value, label]) => ({ value, label })) }]} />
      <ReportTable filename={`sales-by-${by}-${f.from}-${f.to}.csv`} data={rows} columns={[
        { key: "label", header: DIMS[by] },
        { key: "qty", header: "Qty", kind: "int" },
        { key: "netSales", header: by === "modifier" ? "Add-on sales" : "Net sales", kind: "money" },
        { key: "pct", header: "% of total", kind: "pct" },
      ]} />
    </>
  );
}
