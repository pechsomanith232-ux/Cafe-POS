import { ReportFilters } from "@/components/reports/report-filters";
import { ReportHeader, fmtRange } from "@/components/reports/report-header";
import { ReportTable } from "@/components/reports/report-table";
import { AccessDenied } from "@/components/shared/access-denied";
import { getContext } from "@/lib/context";
import { usageVariance } from "@/lib/queries/reports/inventory";
import { filterProps, readReportFilter } from "@/lib/reports/filters";

export const metadata = { title: "Theoretical vs actual usage · Café POS" };

export default async function UsagePage({ searchParams }: PageProps<"/reports/usage">) {
  const ctx = await getContext();
  const f = readReportFilter(ctx, await searchParams, "reports.inventory");
  if (!f.branches.length) return <AccessDenied permission="reports.inventory" />;
  const rows = await usageVariance(ctx, f);
  return (
    <>
      <ReportHeader title="Theoretical vs actual usage" scope={`${f.branchLabel} · ${fmtRange(f.from, f.to)}`} />
      <div className="mb-4 max-w-3xl text-sm text-muted-foreground print:hidden">
        <p><b>Recorded</b>: recipe usage the POS deducted. <b>Estimated</b>: recipe usage of sales that don&apos;t deduct stock (from today&apos;s recipes).
          <b> Adjustments</b>: waste and other write-offs. <b>Count variance</b>: stock count corrections (negative = shortage).
          <b> Actual</b> = recorded + adjustments − count variance. <b>Variance</b> = actual − (recorded + estimated), shown only for items counted in the period. All in base units.</p>
      </div>
      <ReportFilters {...filterProps(f)} />
      <ReportTable filename={`usage-variance-${f.from}-${f.to}.csv`} data={rows} columns={[
        { key: "item", header: "Item" }, { key: "unit", header: "Unit" },
        { key: "recorded", header: "Recorded", kind: "qty" }, { key: "estimated", header: "Estimated", kind: "qty" },
        { key: "adjustments", header: "Adjustments", kind: "qty" }, { key: "countVariance", header: "Count variance", kind: "qty" },
        { key: "actual", header: "Actual", kind: "qty" }, { key: "variance", header: "Variance", kind: "qty" }, { key: "varianceValue", header: "Variance value", kind: "money" },
      ]} />
    </>
  );
}
