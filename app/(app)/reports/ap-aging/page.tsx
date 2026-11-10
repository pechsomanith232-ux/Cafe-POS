import { ReportFilters } from "@/components/reports/report-filters";
import { ReportHeader } from "@/components/reports/report-header";
import { ReportTable } from "@/components/reports/report-table";
import { StatTiles } from "@/components/reports/stat-tiles";
import { AccessDenied } from "@/components/shared/access-denied";
import { getContext } from "@/lib/context";
import { usd } from "@/lib/format";
import { apAgingReport } from "@/lib/queries/reports/purchasing";
import { asOfParam, filterProps, readReportFilter, str } from "@/lib/reports/filters";

export const metadata = { title: "AP aging · Café POS" };
const BUCKETS = [["current", "Current"], ["d1_30", "1–30"], ["d31_60", "31–60"], ["d61_90", "61–90"], ["d90_plus", "90+"], ["total", "Total"]] as const;

export default async function ApAgingReportPage({ searchParams }: PageProps<"/reports/ap-aging">) {
  const ctx = await getContext();
  const sp = await searchParams;
  const f = readReportFilter(ctx, sp, "reports.ap");
  if (!f.branches.length) return <AccessDenied permission="reports.ap" />;
  const asOf = asOfParam(sp.asOf, f.today);
  const data = await apAgingReport(ctx, { branch: f.branch, asOf });
  const supplier = str(sp.supplier);
  const picked = data.rows.find((r) => r.supplierId === supplier);
  const invoices = data.rows.filter((r) => !picked || r === picked).flatMap((r) => r.invoices.map((i) => ({ ...i, supplierName: r.supplierName, supplierId: r.supplierId })));
  return (
    <>
      <ReportHeader title="AP aging" scope={`${f.branchLabel} · as of ${asOf}`} description="Credit purchases still owed, by days past due. Click a supplier to see their invoices." />
      <ReportFilters {...filterProps(f)} dates="asOf" asOf={asOf} />
      <StatTiles tiles={BUCKETS.map(([k, label]) => ({ label: label === "Total" ? "Total owed" : `${label} days`.replace("Current days", "Current"), value: usd(data.totals[k]) }))} />
      <ReportTable filename={`ap-aging-${asOf}.csv`} emptyText="Nothing owed." data={data.rows.map((r) => ({ ...r, drill: `?branch=${f.branch}&asOf=${asOf}&supplier=${r.supplierId}` }))} columns={[
        { key: "supplierName", header: "Supplier", link: { prefix: "", key: "drill" } },
        ...BUCKETS.map(([k, label]) => ({ key: k, header: label, kind: "money" as const })),
      ]} />
      <h2 className="mt-6 mb-2 font-medium">Open invoices{picked ? ` — ${picked.supplierName}` : ""}</h2>
      <ReportTable filename={`ap-invoices-${asOf}.csv`} emptyText="No open invoices." data={invoices} columns={[
        { key: "ref", header: "Receipt", link: { prefix: "/purchasing/receipts/", key: "receiptId" } },
        { key: "supplierName", header: "Supplier" }, { key: "invoiceNo", header: "Invoice" },
        { key: "receiptDate", header: "Date" }, { key: "dueDate", header: "Due" },
        { key: "total", header: "Total", kind: "money" }, { key: "amountDue", header: "Still owed", kind: "money" },
      ]} />
    </>
  );
}
