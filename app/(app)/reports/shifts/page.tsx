import { ReportFilters } from "@/components/reports/report-filters";
import { ReportHeader, fmtRange } from "@/components/reports/report-header";
import { ReportTable } from "@/components/reports/report-table";
import { AccessDenied } from "@/components/shared/access-denied";
import { getContext } from "@/lib/context";
import { shiftList } from "@/lib/queries/reports/logs";
import { filterProps, readReportFilter } from "@/lib/reports/filters";

export const metadata = { title: "Shift reports · Café POS" };

export default async function ShiftsReportPage({ searchParams }: PageProps<"/reports/shifts">) {
  const ctx = await getContext();
  const f = readReportFilter(ctx, await searchParams, "reports.sales");
  if (!f.branches.length) return <AccessDenied permission="reports.sales" />;
  const rows = await shiftList(ctx, f);
  return (
    <>
      <ReportHeader title="Shift reports" scope={`${f.branchLabel} · ${fmtRange(f.from, f.to)}`} description="Shifts opened in the period. Open one for its X (open) or Z (closed) report." />
      <ReportFilters {...filterProps(f)} />
      <ReportTable filename={`shifts-${f.from}-${f.to}.csv`} data={rows} columns={[
        { key: "openedAt", header: "Opened", kind: "datetime", link: { prefix: "/pos/shift/", key: "id", suffix: "/report" } },
        { key: "branch", header: "Branch" },
        { key: "register", header: "Register" },
        { key: "status", header: "Status", labels: { open: "Open", closed: "Closed" } },
        { key: "openedBy", header: "Opened by" },
        { key: "closedAt", header: "Closed", kind: "datetime" },
        { key: "closedBy", header: "Closed by" },
        { key: "orders", header: "Orders", kind: "int" },
        { key: "sales", header: "Sales (before refunds)", kind: "money" },
      ]} />
    </>
  );
}
