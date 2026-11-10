import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getContext } from "@/lib/context";
import { NotFoundError } from "@/lib/errors";
import { num, usd } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import { getCustomer } from "@/lib/queries/customers";
import { getOpenShift, listRegisters } from "@/lib/queries/pos";
import { listPaymentMethods } from "@/lib/queries/purchasing";
import { ReceivePayment } from "./receive-payment";

export default async function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  const ctx = await getContext();
  if (!hasPermission(ctx, ctx.branchId, "customers.manage") && !hasPermission(ctx, ctx.branchId, "ar.receive_payment")) return <AccessDenied permission="customers.manage" />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const c = await getCustomer(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const canReceive = hasPermission(ctx, ctx.branchId, "ar.receive_payment");
  const [methods, registers] = canReceive ? await Promise.all([listPaymentMethods(ctx), listRegisters(ctx, ctx.branchId)]) : [[], []];
  const drawers = (await Promise.all(registers.map(async (r) => ((await getOpenShift(ctx, ctx.branchId, r.id)) ? { registerId: r.id, name: r.name } : null)))).filter((d) => d !== null);
  const fmt = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { timeZone: "Asia/Phnom_Penh" }) : "—");
  return (
    <>
      <PageHeader title={c.name} description={`${c.phone ?? "No phone"} · owes ${usd(c.balance)}${c.creditLimit ? ` of ${usd(c.creditLimit)} limit` : " · no credit account"}${Number(c.credit) > 0 ? ` · credit ${usd(c.credit)}` : ""}`}
        actions={canReceive && <ReceivePayment customerId={c.id} branchId={ctx.branchId} methods={methods.filter((m) => m.type !== "account").map((m) => ({ id: m.id, name: m.name, type: m.type }))} drawers={drawers} owes={c.balance} />} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Unpaid charged orders</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Owes</TableHead></TableRow></TableHeader>
              <TableBody>
                {c.openOrders.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Nothing owed.</TableCell></TableRow>}
                {c.openOrders.map((o) => <TableRow key={o.id}><TableCell>{o.orderNo}</TableCell><TableCell>{fmt(o.paidAt)}</TableCell><TableCell className="text-right">{usd(o.total)}</TableCell><TableCell className="text-right font-medium">{usd(o.accountDue)}</TableCell></TableRow>)}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Payments</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">USD</TableHead></TableRow></TableHeader>
              <TableBody>
                {c.payments.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No payments yet.</TableCell></TableRow>}
                {c.payments.map((p) => <TableRow key={p.id}><TableCell>{fmt(p.paymentDate)}</TableCell><TableCell>{p.method}</TableCell><TableCell className="text-right">{p.currencyCode === "KHR" ? `${num(p.amount, 0)}៛` : usd(p.amount)}</TableCell><TableCell className="text-right">{usd(p.amountBase)}</TableCell></TableRow>)}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
