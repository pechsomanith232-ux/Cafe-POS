import { ReportFilters } from "@/components/reports/report-filters";
import { ReportHeader, fmtRange } from "@/components/reports/report-header";
import { ReportTable } from "@/components/reports/report-table";
import { AccessDenied } from "@/components/shared/access-denied";
import { getContext } from "@/lib/context";
import { salesByPayment } from "@/lib/queries/reports/sales";
import { filterProps, readReportFilter } from "@/lib/reports/filters";

export const metadata = { title: "Payments & currency · Café POS" };

export default async function PaymentsReportPage({ searchParams }: PageProps<"/reports/payments">) {
  const ctx = await getContext();
  const f = readReportFilter(ctx, await searchParams, "reports.sales");
  if (!f.branches.length) return <AccessDenied permission="reports.sales" />;
  const p = await salesByPayment(ctx, f);
  return (
    <>
      <ReportHeader title="Payments & currency" scope={`${f.branchLabel} · ${fmtRange(f.from, f.to)}`}
        description="Amounts are in each payment's own currency; the USD column converts at the rate used." />
      <ReportFilters {...filterProps(f)} />
      <h2 className="mb-2 font-medium">Cash by currency</h2>
      <p className="mb-2 text-sm text-muted-foreground">Received − change given − refunds paid out = net cash from sales. Customer payments, pay-ins/outs and drawer purchases are on the shift report.</p>
      <ReportTable filename={`cash-by-currency-${f.from}-${f.to}.csv`} data={p.cash} emptyText="No cash in this period." columns={[
        { key: "currency", header: "Currency" },
        { key: "received", header: "Received", kind: "qty" },
        { key: "change", header: "Change given", kind: "qty" },
        { key: "refunded", header: "Refunded", kind: "qty" },
        { key: "net", header: "Net cash", kind: "qty" },
      ]} />
      <h2 className="mt-6 mb-2 font-medium">By payment method</h2>
      <ReportTable filename={`payments-by-method-${f.from}-${f.to}.csv`} data={p.methods} columns={[
        { key: "method", header: "Method" },
        { key: "currency", header: "Currency" },
        { key: "count", header: "Payments", kind: "int" },
        { key: "received", header: "Received", kind: "qty" },
        { key: "receivedBase", header: "Received (USD)", kind: "money" },
        { key: "refunded", header: "Refunded", kind: "qty" },
        { key: "refundedBase", header: "Refunded (USD)", kind: "money" },
      ]} />
    </>
  );
}
