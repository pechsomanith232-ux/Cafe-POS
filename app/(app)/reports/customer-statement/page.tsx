import { ReportFilters } from "@/components/reports/report-filters";
import { ReportHeader, fmtRange } from "@/components/reports/report-header";
import { ReportTable } from "@/components/reports/report-table";
import { StatTiles } from "@/components/reports/stat-tiles";
import { AccessDenied } from "@/components/shared/access-denied";
import { getContext } from "@/lib/context";
import { usd } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import { listCustomers } from "@/lib/queries/customers";
import { customerStatement } from "@/lib/queries/reports/ar";
import { filterProps, readReportFilter, str } from "@/lib/reports/filters";

export const metadata = { title: "Customer statement · Café POS" };

export default async function CustomerStatementPage({ searchParams }: PageProps<"/reports/customer-statement">) {
  const ctx = await getContext();
  if (!hasPermission(ctx, ctx.branchId, "reports.ar")) return <AccessDenied permission="reports.ar" />;
  const sp = await searchParams;
  const f = readReportFilter(ctx, sp, "reports.ar", { allowAll: false, defaultDays: 30 });
  const list = await listCustomers(ctx, { includeInactive: true });
  const customerId = list.find((c) => c.id === str(sp.customer))?.id;
  const st = customerId ? await customerStatement(ctx, { customerId, from: f.from, to: f.to }) : null;
  return (
    <>
      <ReportHeader title={st ? `Statement — ${st.customer.name}` : "Customer statement"} scope={`All branches · ${fmtRange(f.from, f.to)}`} description="Charges to account (debit), refunds to account and payments (credit), with a running balance." />
      <ReportFilters {...filterProps(f)} branches={[]} canAll={false} selects={[{ name: "customer", label: "Choose a customer", value: customerId ?? "", width: "w-56", options: list.map((c) => ({ value: c.id, label: c.name })) }]} />
      {!st ? <p className="text-sm text-muted-foreground">Choose a customer.</p> : (
        <>
          <StatTiles tiles={[{ label: "Opening balance", value: usd(st.opening) }, { label: "Closing balance", value: usd(st.closing) }]} />
          <ReportTable filename={`customer-statement-${f.from}-${f.to}.csv`} data={st.rows} columns={[
            { key: "date", header: "Date" }, { key: "kind", header: "Type", labels: { charge: "Charge", refund: "Refund", payment: "Payment" } }, { key: "ref", header: "Ref" },
            { key: "debit", header: "Debit", kind: "money" }, { key: "credit", header: "Credit", kind: "money" }, { key: "balance", header: "Balance", kind: "money" },
          ]} />
        </>
      )}
    </>
  );
}
