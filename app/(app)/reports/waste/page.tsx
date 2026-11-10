import { ReportFilters } from "@/components/reports/report-filters";
import { ReportHeader, fmtRange } from "@/components/reports/report-header";
import { ReportTable } from "@/components/reports/report-table";
import { AccessDenied } from "@/components/shared/access-denied";
import { getContext } from "@/lib/context";
import { REASON_LABELS } from "@/lib/format";
import { wasteReport } from "@/lib/queries/reports/inventory";
import { filterProps, readReportFilter } from "@/lib/reports/filters";

export const metadata = { title: "Waste & adjustments · Café POS" };

export default async function WastePage({ searchParams }: PageProps<"/reports/waste">) {
  const ctx = await getContext();
  const f = readReportFilter(ctx, await searchParams, "reports.inventory");
  if (!f.branches.length) return <AccessDenied permission="reports.inventory" />;
  const w = await wasteReport(ctx, f);
  return (
    <>
      <ReportHeader title="Waste & adjustments" scope={`${f.branchLabel} · ${fmtRange(f.from, f.to)}`} description="Posted stock adjustments, valued at cost. Stock count corrections are in Theoretical vs actual usage." />
      <ReportFilters {...filterProps(f)} />
      <h2 className="mb-2 font-medium">By reason</h2>
      <ReportTable filename={`waste-by-reason-${f.from}-${f.to}.csv`} data={w.byReason} columns={[
        { key: "reason", header: "Reason", labels: REASON_LABELS }, { key: "lines", header: "Lines", kind: "int" }, { key: "value", header: "Value lost", kind: "money" },
      ]} />
      <h2 className="mt-6 mb-2 font-medium">Lines</h2>
      <ReportTable filename={`waste-lines-${f.from}-${f.to}.csv`} data={w.rows} columns={[
        { key: "date", header: "Date", link: { prefix: "/inventory/adjustments/", key: "adjustmentId" } },
        ...(f.branch === "all" ? [{ key: "branch", header: "Branch" }] : []),
        { key: "reason", header: "Reason", labels: REASON_LABELS }, { key: "item", header: "Item" },
        { key: "qty", header: "Qty", kind: "qty" }, { key: "unit", header: "Unit" }, { key: "value", header: "Value", kind: "money" }, { key: "note", header: "Note" },
      ]} />
    </>
  );
}
