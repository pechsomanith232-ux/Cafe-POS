import { ReportFilters } from "@/components/reports/report-filters";
import { ReportHeader, fmtRange } from "@/components/reports/report-header";
import { ReportTable } from "@/components/reports/report-table";
import { AccessDenied } from "@/components/shared/access-denied";
import { getContext } from "@/lib/context";
import { salesByStaff } from "@/lib/queries/reports/sales";
import { filterProps, readReportFilter } from "@/lib/reports/filters";

export const metadata = { title: "Sales by staff · Café POS" };

export default async function StaffReportPage({ searchParams }: PageProps<"/reports/staff">) {
  const ctx = await getContext();
  const f = readReportFilter(ctx, await searchParams, "reports.sales");
  if (!f.branches.length) return <AccessDenied permission="reports.sales" />;
  const rows = await salesByStaff(ctx, f);
  return (
    <>
      <ReportHeader title="Sales by staff" scope={`${f.branchLabel} · ${fmtRange(f.from, f.to)}`}
        description="Orders each person rang up, and the voids and refunds they made. Net sales exclude tax." />
      <ReportFilters {...filterProps(f)} />
      <ReportTable filename={`sales-by-staff-${f.from}-${f.to}.csv`} data={rows} columns={[
        { key: "name", header: "Staff" },
        { key: "orders", header: "Orders", kind: "int" },
        { key: "netSales", header: "Net sales", kind: "money" },
        { key: "avgTicket", header: "Avg ticket", kind: "money" },
        { key: "voids", header: "Voids", kind: "int" },
        { key: "voidTotal", header: "Voided value", kind: "money" },
        { key: "refunds", header: "Refunds", kind: "int" },
        { key: "refundTotal", header: "Refunded", kind: "money" },
      ]} />
    </>
  );
}
