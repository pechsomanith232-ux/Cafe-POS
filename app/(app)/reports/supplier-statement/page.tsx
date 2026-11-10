import { and, asc, eq } from "drizzle-orm";
import { suppliers } from "@/db/schema";
import { ReportFilters } from "@/components/reports/report-filters";
import { ReportHeader, fmtRange } from "@/components/reports/report-header";
import { ReportTable } from "@/components/reports/report-table";
import { StatTiles } from "@/components/reports/stat-tiles";
import { AccessDenied } from "@/components/shared/access-denied";
import { getContext } from "@/lib/context";
import { usd } from "@/lib/format";
import { supplierStatementReport } from "@/lib/queries/reports/purchasing";
import { filterProps, readReportFilter, str } from "@/lib/reports/filters";

export const metadata = { title: "Supplier statement · Café POS" };

export default async function SupplierStatementPage({ searchParams }: PageProps<"/reports/supplier-statement">) {
  const ctx = await getContext();
  const sp = await searchParams;
  const f = readReportFilter(ctx, sp, "reports.ap", { allowAll: false, defaultDays: 30 });
  if (!f.branches.length) return <AccessDenied permission="reports.ap" />;
  const list = await ctx.db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(and(eq(suppliers.orgId, ctx.orgId))).orderBy(asc(suppliers.name));
  const supplierId = list.find((s) => s.id === str(sp.supplier))?.id;
  const st = supplierId ? await supplierStatementReport(ctx, { supplierId, branchId: f.branch, from: f.from, to: f.to }) : null;
  return (
    <>
      <ReportHeader title={st ? `Statement — ${st.supplier.name}` : "Supplier statement"} scope={`${f.branchLabel} · ${fmtRange(f.from, f.to)}`} description="Invoices (debit), payments and return credits (credit), with a running balance owed." />
      <ReportFilters {...filterProps(f)} selects={[{ name: "supplier", label: "Choose a supplier", value: supplierId ?? "", width: "w-56", options: list.map((s) => ({ value: s.id, label: s.name })) }]} />
      {!st ? <p className="text-sm text-muted-foreground">Choose a supplier.</p> : (
        <>
          <StatTiles tiles={[{ label: "Opening balance", value: usd(st.opening) }, { label: "Closing balance", value: usd(st.closing) }]} />
          <ReportTable filename={`supplier-statement-${f.from}-${f.to}.csv`} data={st.rows} columns={[
            { key: "date", header: "Date" }, { key: "ref", header: "Ref" }, { key: "description", header: "Description" },
            { key: "debit", header: "Debit", kind: "money" }, { key: "credit", header: "Credit", kind: "money" }, { key: "balance", header: "Balance", kind: "money" },
          ]} />
        </>
      )}
    </>
  );
}
