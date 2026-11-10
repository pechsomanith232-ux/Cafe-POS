import { ReportFilters } from "@/components/reports/report-filters";
import { ReportHeader } from "@/components/reports/report-header";
import { ReportTable } from "@/components/reports/report-table";
import { AccessDenied } from "@/components/shared/access-denied";
import { getContext } from "@/lib/context";
import { reorderReport } from "@/lib/queries/reports/inventory";
import { filterProps, readReportFilter } from "@/lib/reports/filters";

export const metadata = { title: "Low stock & reorder · Café POS" };

export default async function ReorderPage({ searchParams }: PageProps<"/reports/reorder">) {
  const ctx = await getContext();
  const f = readReportFilter(ctx, await searchParams, "reports.inventory");
  if (!f.branches.length) return <AccessDenied permission="reports.inventory" />;
  const rows = await reorderReport(ctx, { branch: f.branch });
  return (
    <>
      <ReportHeader title="Low stock & suggested reorder" scope={`${f.branchLabel} · now`}
        description="Items at or below their reorder level. The suggestion brings stock up to twice the reorder level, valued at the last purchase cost." />
      <ReportFilters {...filterProps(f)} dates="none" />
      <ReportTable filename="reorder.csv" data={rows} emptyText="Nothing is low on stock." columns={[
        ...(f.branch === "all" ? [{ key: "branch", header: "Branch" }] : []),
        { key: "item", header: "Item" }, { key: "unit", header: "Unit" },
        { key: "onHand", header: "On hand", kind: "qty" }, { key: "reorderLevel", header: "Reorder level", kind: "qty" },
        { key: "suggested", header: "Suggested order", kind: "qty" }, { key: "suggestedValue", header: "Est. cost", kind: "money" },
        { key: "lastSupplier", header: "Last supplier" },
      ]} />
    </>
  );
}
