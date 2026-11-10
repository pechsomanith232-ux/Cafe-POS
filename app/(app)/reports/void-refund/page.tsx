import { ReportFilters } from "@/components/reports/report-filters";
import { ReportHeader, fmtRange } from "@/components/reports/report-header";
import { ReportTable } from "@/components/reports/report-table";
import { AccessDenied } from "@/components/shared/access-denied";
import { getContext } from "@/lib/context";
import { voidRefundLog } from "@/lib/queries/reports/logs";
import { filterProps, readReportFilter } from "@/lib/reports/filters";

export const metadata = { title: "Void & refund log · Café POS" };

export default async function VoidRefundPage({ searchParams }: PageProps<"/reports/void-refund">) {
  const ctx = await getContext();
  const f = readReportFilter(ctx, await searchParams, "reports.sales");
  if (!f.branches.length) return <AccessDenied permission="reports.sales" />;
  const rows = await voidRefundLog(ctx, f);
  return (
    <>
      <ReportHeader title="Void & refund log" scope={`${f.branchLabel} · ${fmtRange(f.from, f.to)}`} description="Every void and refund with who did it, who approved it and why." />
      <ReportFilters {...filterProps(f)} />
      <ReportTable filename={`voids-refunds-${f.from}-${f.to}.csv`} data={rows} columns={[
        { key: "at", header: "When", kind: "datetime" },
        { key: "kind", header: "Type", labels: { void: "Void", refund: "Refund" } },
        { key: "orderNo", header: "Order", link: { prefix: "/receipt/", key: "orderId" } },
        { key: "branch", header: "Branch" },
        { key: "amount", header: "Amount", kind: "money" },
        { key: "reason", header: "Reason" },
        { key: "byName", header: "By" },
        { key: "approvedByName", header: "Approved by" },
      ]} />
    </>
  );
}
