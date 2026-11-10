import { Plus } from "lucide-react";
import Link from "next/link";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getContext } from "@/lib/context";
import { usd } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import { listPayments } from "@/lib/queries/purchasing";

export const metadata = { title: "Supplier payments · Café POS" };

export default async function PaymentsPage() {
  const ctx = await getContext();
  if (!hasPermission(ctx, ctx.branchId, "purchasing.pay") && !hasPermission(ctx, ctx.branchId, "purchasing.view")) {
    return <AccessDenied permission="purchasing.view" />;
  }
  const rows = await listPayments(ctx, ctx.branchId);
  return (
    <>
      <PageHeader title="Supplier payments" description="Money paid to suppliers and return credits at this branch."
        actions={hasPermission(ctx, ctx.branchId, "purchasing.pay") ? <Button asChild><Link href="/purchasing/payments/new"><Plus /> Record payment</Link></Button> : undefined} />
      <div className="rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead>No.</TableHead><TableHead>Date</TableHead><TableHead>Supplier</TableHead><TableHead>Type</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">In USD</TableHead><TableHead className="text-right">Unallocated</TableHead><TableHead>Reference / note</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell>PAY-{String(p.number).padStart(6, "0")}</TableCell>
                <TableCell>{p.paymentDate}</TableCell>
                <TableCell>{p.supplierId ? <Link className="hover:underline" href={`/purchasing/suppliers/${p.supplierId}`}>{p.supplierName}</Link> : "—"}</TableCell>
                <TableCell>{p.kind === "return_credit" ? "Return credit" : "Payment"}</TableCell>
                <TableCell>{p.method ?? "—"}</TableCell>
                <TableCell className="text-right">{p.currencyCode === "USD" ? usd(p.amount) : `${Number(p.amount).toLocaleString()} ${p.currencyCode}`}</TableCell>
                <TableCell className="text-right">{usd(p.amountBase)}</TableCell>
                <TableCell className="text-right">{Number(p.unallocatedBase) > 0 ? usd(p.unallocatedBase) : "—"}</TableCell>
                <TableCell className="max-w-56 truncate text-sm text-muted-foreground">{[p.reference, p.note].filter(Boolean).join(" · ") || "—"}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">No payments yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
