import { DailySalesChart } from "@/components/reports/daily-sales-chart";
import { ReportFilters } from "@/components/reports/report-filters";
import { ReportHeader, fmtRange } from "@/components/reports/report-header";
import { ReportTable } from "@/components/reports/report-table";
import { StatTiles } from "@/components/reports/stat-tiles";
import { AccessDenied } from "@/components/shared/access-denied";
import { getContext } from "@/lib/context";
import { usd } from "@/lib/format";
import { salesSummary } from "@/lib/queries/reports/sales";
import { filterProps, readReportFilter } from "@/lib/reports/filters";

export const metadata = { title: "Sales summary · Café POS" };

const COLS = [
  { key: "orders", header: "Orders", kind: "int" as const },
  { key: "grossSales", header: "Gross", kind: "money" as const },
  { key: "discounts", header: "Discounts", kind: "money" as const },
  { key: "netSales", header: "Net sales", kind: "money" as const },
  { key: "tax", header: "Tax", kind: "money" as const },
  { key: "refundsExTax", header: "Refunds (ex tax)", kind: "money" as const },
  { key: "netAfterRefunds", header: "Net after refunds", kind: "money" as const },
  { key: "avgTicket", header: "Avg ticket", kind: "money" as const },
];

export default async function SalesSummaryPage({ searchParams }: PageProps<"/reports/sales">) {
  const ctx = await getContext();
  const f = readReportFilter(ctx, await searchParams, "reports.sales");
  if (!f.branches.length) return <AccessDenied permission="reports.sales" />;
  const s = await salesSummary(ctx, f);
  const t = s.totals;
  return (
    <>
      <ReportHeader title="Sales summary" scope={`${f.branchLabel} · ${fmtRange(f.from, f.to)}`}
        description="Sales are dated by payment, refunds by the day they were given. Net sales exclude tax." />
      <ReportFilters {...filterProps(f)} />
      <StatTiles tiles={[
        { label: "Net after refunds", value: usd(t.netAfterRefunds) },
        { label: "Net sales", value: usd(t.netSales), note: "Gross − discounts, excluding tax" },
        { label: "Refunds", value: usd(t.refunds) },
        { label: "Orders", value: t.orders.toLocaleString("en-US") },
        { label: "Average ticket", value: usd(t.avgTicket) },
        { label: "Tax", value: usd(t.tax) },
      ]} />
      {s.byDay.length > 1 && (
        <div className="mb-6 rounded-lg border bg-card p-4">
          <DailySalesChart title="Net sales after refunds, by day" data={s.byDay.map((d) => ({ date: d.date, netSales: d.netAfterRefunds, orders: d.orders }))} />
        </div>
      )}
      <h2 className="mb-2 font-medium">By day</h2>
      <ReportTable filename={`sales-by-day-${f.from}-${f.to}.csv`} data={s.byDay} columns={[{ key: "date", header: "Date" }, ...COLS]} />
      <h2 className="mt-6 mb-2 font-medium">By hour</h2>
      <ReportTable filename={`sales-by-hour-${f.from}-${f.to}.csv`} data={s.byHour.map((h) => ({ ...h, hourLabel: `${String(h.hour).padStart(2, "0")}:00` }))}
        columns={[{ key: "hourLabel", header: "Hour" }, ...COLS]} />
    </>
  );
}
