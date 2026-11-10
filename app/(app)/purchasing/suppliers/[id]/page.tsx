import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getContext } from "@/lib/context";
import { todayLocal } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { usd } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import { getSupplier, supplierStatement } from "@/lib/queries/purchasing";
import { AllocateCredit, SupplierActions } from "./supplier-actions";

const label = (n: number, p = "GR") => `${p}-${String(n).padStart(6, "0")}`;

export default async function SupplierPage({ params }: PageProps<"/purchasing/suppliers/[id]">) {
  const ctx = await getContext();
  if (!hasPermission(ctx, ctx.branchId, "purchasing.view")) return <AccessDenied permission="purchasing.view" />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const today = todayLocal();
  const s = await getSupplier(ctx, id, today).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const statement = await supplierStatement(ctx, { supplierId: id, branchId: ctx.branchId });
  const canPay = hasPermission(ctx, ctx.branchId, "purchasing.pay");
  const canEdit = canPay || hasPermission(ctx, ctx.branchId, "purchasing.receive");
  const branch = ctx.access.get(ctx.branchId)!;
  const buckets: [string, string][] = [["Current", s.aging.current], ["1–30", s.aging.d1_30], ["31–60", s.aging.d31_60], ["61–90", s.aging.d61_90], ["90+", s.aging.d90_plus]];

  return (
    <>
      <PageHeader
        title={s.name}
        description={[s.contactName, s.phone, s.email, `${s.paymentTermsDays}-day terms`].filter(Boolean).join(" · ")}
        actions={
          <div className="flex gap-2">
            {!s.isActive && <Badge variant="outline">Inactive</Badge>}
            {canPay && <Button asChild><Link href={`/purchasing/payments/new?supplier=${s.id}`}>Record payment</Link></Button>}
            {hasPermission(ctx, ctx.branchId, "purchasing.receive") && <Button asChild variant="outline"><Link href={`/purchasing/receipts/new?type=credit&supplier=${s.id}`}>New receipt</Link></Button>}
            {canEdit && <SupplierActions supplier={{ id: s.id, isActive: s.isActive, name: s.name, contactName: s.contactName ?? "", phone: s.phone ?? "", email: s.email ?? "", address: s.address ?? "", paymentTermsDays: s.paymentTermsDays, note: s.note ?? "" }} />}
          </div>
        }
      />
      <div className="mb-6 grid max-w-5xl gap-4 sm:grid-cols-3">
        <Card><CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Owed at {branch.branchCode}</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{usd(s.owed)}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Unused credit</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{usd(s.creditBalance)}</CardContent></Card>
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Aging (days overdue)</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-5 gap-1 text-center text-xs">
            {buckets.map(([k, v]) => <div key={k}><div className="text-muted-foreground">{k}</div><div className="font-medium">{usd(v, 0)}</div></div>)}
          </CardContent>
        </Card>
      </div>
      <Tabs defaultValue="open" className="max-w-5xl">
        <TabsList>
          <TabsTrigger value="open">Open invoices ({s.openReceipts.length})</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="statement">Statement</TabsTrigger>
        </TabsList>
        <TabsContent value="open">
          <div className="rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead>Receipt</TableHead><TableHead>Invoice no.</TableHead><TableHead>Date</TableHead><TableHead>Due</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Due now</TableHead></TableRow></TableHeader>
              <TableBody>
                {s.openReceipts.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><Link className="hover:underline" href={`/purchasing/receipts/${r.id}`}>{label(r.number)}</Link></TableCell>
                    <TableCell>{r.supplierInvoiceNo ?? "—"}</TableCell>
                    <TableCell>{r.receiptDate}</TableCell>
                    <TableCell className={r.dueDate && r.dueDate < today ? "text-destructive" : undefined}>{r.dueDate ?? "—"}</TableCell>
                    <TableCell className="text-right">{usd(r.total)}</TableCell>
                    <TableCell className="text-right">{usd(r.amountDue)}</TableCell>
                  </TableRow>
                ))}
                {s.openReceipts.length === 0 && <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">Nothing owed.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
        <TabsContent value="payments">
          <div className="rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead>No.</TableHead><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">In USD</TableHead><TableHead className="text-right">Unallocated</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {s.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{label(p.number, "PAY")}</TableCell>
                    <TableCell>{p.paymentDate}</TableCell>
                    <TableCell>{p.kind === "return_credit" ? "Return credit" : "Payment"}</TableCell>
                    <TableCell>{p.method ?? "—"}</TableCell>
                    <TableCell className="text-right">{p.currencyCode === "USD" ? usd(p.amount) : `${Number(p.amount).toLocaleString()} ${p.currencyCode}`}</TableCell>
                    <TableCell className="text-right">{usd(p.amountBase)}</TableCell>
                    <TableCell className="text-right">{Number(p.unallocatedBase) > 0 ? usd(p.unallocatedBase) : "—"}</TableCell>
                    <TableCell className="text-right">{canPay && Number(p.unallocatedBase) > 0 && s.openReceipts.length > 0 && <AllocateCredit paymentId={p.id} unallocated={p.unallocatedBase} open={s.openReceipts} />}</TableCell>
                  </TableRow>
                ))}
                {s.payments.length === 0 && <TableRow><TableCell colSpan={8} className="py-6 text-center text-muted-foreground">No payments yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
        <TabsContent value="statement">
          <div className="rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Ref</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Charges</TableHead><TableHead className="text-right">Payments / credits</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader>
              <TableBody>
                {statement.rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>{r.date}</TableCell><TableCell>{r.ref}</TableCell><TableCell>{r.description}</TableCell>
                    <TableCell className="text-right">{r.debit ? usd(r.debit) : ""}</TableCell>
                    <TableCell className="text-right">{r.credit ? usd(r.credit) : ""}</TableCell>
                    <TableCell className="text-right font-medium">{usd(r.balance)}</TableCell>
                  </TableRow>
                ))}
                {statement.rows.length === 0 && <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">No activity at this branch.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
