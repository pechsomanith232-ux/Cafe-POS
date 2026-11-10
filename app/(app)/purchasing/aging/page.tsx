import Link from "next/link";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getContext } from "@/lib/context";
import { todayLocal } from "@/lib/dates";
import { usd } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import { apAging } from "@/lib/queries/purchasing";
import { AgingCsv } from "./aging-csv";

export const metadata = { title: "AP aging · Café POS" };

export default async function AgingPage({ searchParams }: PageProps<"/purchasing/aging">) {
  const ctx = await getContext();
  if (!hasPermission(ctx, ctx.branchId, "reports.ap")) return <AccessDenied permission="reports.ap" />;
  const sp = await searchParams;
  const asOf = typeof sp.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.asOf) ? sp.asOf : todayLocal();
  const aging = await apAging(ctx, { branchId: ctx.branchId, asOf });
  const cols = [["current", "Current"], ["d1_30", "1–30"], ["d31_60", "31–60"], ["d61_90", "61–90"], ["d90_plus", "90+"], ["total", "Total"]] as const;
  return (
    <>
      <PageHeader title="AP aging" description="What this branch owes suppliers, by days overdue. Direct (pay-now) purchases never appear here." />
      <form className="mb-4 flex items-end gap-2" action="/purchasing/aging">
        <label className="text-xs text-muted-foreground">As of<Input type="date" name="asOf" defaultValue={asOf} /></label>
        <Button type="submit" variant="outline">Show</Button>
        <AgingCsv rows={aging.rows} asOf={asOf} />
      </form>
      <div className="max-w-5xl rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead>Supplier</TableHead>{cols.map(([k, l]) => <TableHead key={k} className="text-right">{l}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {aging.rows.map((r) => (
              <TableRow key={r.supplierId}>
                <TableCell><Link className="hover:underline" href={`/purchasing/suppliers/${r.supplierId}`}>{r.supplierName}</Link></TableCell>
                {cols.map(([k]) => <TableCell key={k} className={`text-right ${k === "total" ? "font-medium" : ""} ${k !== "current" && k !== "total" && Number(r[k]) > 0 ? "text-destructive" : ""}`}>{Number(r[k]) ? usd(r[k]) : "—"}</TableCell>)}
              </TableRow>
            ))}
            {aging.rows.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Nothing owed.</TableCell></TableRow>}
            {aging.rows.length > 0 && (
              <TableRow className="font-semibold">
                <TableCell>Total</TableCell>
                {cols.map(([k]) => <TableCell key={k} className="text-right">{usd(aging.totals[k])}</TableCell>)}
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
