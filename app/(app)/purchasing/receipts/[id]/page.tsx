import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { ReceiptEditor } from "@/components/purchasing/receipt-editor";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getContext } from "@/lib/context";
import { todayLocal } from "@/lib/dates";
import { dec } from "@/lib/domain/money";
import { NotFoundError } from "@/lib/errors";
import { num, usd } from "@/lib/format";
import { ForbiddenError, hasPermission } from "@/lib/permissions";
import { getReceipt, listPaymentMethods, listPurchasableItems, listSupplierOptions } from "@/lib/queries/purchasing";
import { ReturnDialog } from "./return-dialog";

const label = (n: number) => `GR-${String(n).padStart(6, "0")}`;

export default async function ReceiptPage({ params }: PageProps<"/purchasing/receipts/[id]">) {
  const ctx = await getContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const r = await getReceipt(ctx, id).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    if (err instanceof ForbiddenError) return null;
    throw err;
  });
  if (!r) return <AccessDenied permission="purchasing.view" />;
  const perm = r.purchaseType === "direct" ? "purchasing.direct" : "purchasing.receive";
  const canEdit = hasPermission(ctx, r.branchId, perm);
  const methods = await listPaymentMethods(ctx, r.branchId);

  if (r.status === "draft" && canEdit) {
    const [items, suppliers] = await Promise.all([listPurchasableItems(ctx), listSupplierOptions(ctx)]);
    return (
      <>
        <PageHeader title={`Draft ${label(r.number)}`} description="Nothing has changed in stock yet." />
        <ReceiptEditor
          type={r.purchaseType as "credit" | "direct"}
          branchId={r.branchId}
          items={items}
          suppliers={suppliers.map((s) => ({ id: s.id, name: s.name, paymentTermsDays: s.paymentTermsDays }))}
          methods={methods.filter((m) => m.type !== "account").map((m) => ({ id: m.id, name: m.name, type: m.type }))}
          today={todayLocal()}
          draft={{
            id: r.id, supplierId: r.supplierId, supplierNameText: r.supplierNameText, supplierInvoiceNo: r.supplierInvoiceNo,
            receiptDate: r.receiptDate, paymentTermsDays: r.paymentTermsDays, note: r.note,
            lines: r.lines.map((l) => {
              const opt = items.find((i) => i.id === l.itemId)?.unitOptions.find((u) => u.label === l.unitLabel);
              // Unit renamed since: fall back to the base unit with the stored base quantity and cost per base unit.
              return opt
                ? { itemId: l.itemId, unitKey: opt.key, qty: num(l.qtyEntered).replace(/,/g, ""), unitCost: String(Number(l.unitCostEntered)) }
                : { itemId: l.itemId, unitKey: "base", qty: l.qtyBase, unitCost: dec(l.lineTotal).div(l.qtyBase).toDecimalPlaces(6).toString() };
            }),
            extraCosts: r.extraCosts.map((e) => ({ description: e.description, amount: String(Number(e.amount)) })),
          }}
        />
      </>
    );
  }

  const supplier = r.supplierName ?? r.supplierNameText ?? "—";
  return (
    <>
      <PageHeader
        title={`${label(r.number)} · ${supplier}`}
        description={`${r.purchaseType === "direct" ? "Direct purchase" : "Credit purchase"} · ${r.receiptDate}${r.supplierInvoiceNo ? ` · invoice ${r.supplierInvoiceNo}` : ""}${r.dueDate ? ` · due ${r.dueDate}` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{r.status === "posted" ? "Posted" : r.status}</Badge>
            {r.status === "posted" && <Badge variant={r.paymentStatus === "paid" ? "secondary" : "default"}>{r.paymentStatus === "paid" ? "Paid" : `${usd(r.amountDue)} due`}</Badge>}
            {r.status === "posted" && canEdit && <ReturnDialog receipt={r} methods={methods.filter((m) => m.type !== "account").map((m) => ({ id: m.id, name: m.name, type: m.type }))} today={todayLocal()} />}
            {r.supplierId && <Link className="text-sm underline" href={`/purchasing/suppliers/${r.supplierId}`}>Supplier</Link>}
          </div>
        }
      />
      <div className="grid max-w-5xl gap-4">
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Item</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Cost / unit</TableHead><TableHead className="text-right">Line</TableHead><TableHead className="text-right">+ Extra</TableHead><TableHead className="text-right">Landed</TableHead><TableHead className="text-right">Landed / base unit</TableHead><TableHead className="text-right">Returned</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {r.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.itemName}</TableCell>
                  <TableCell className="text-right">{num(l.qtyEntered)} {l.unitLabel}<span className="block text-xs text-muted-foreground">{num(l.qtyBase)} {l.baseUnit}</span></TableCell>
                  <TableCell className="text-right">{usd(l.unitCostEntered, 4)}</TableCell>
                  <TableCell className="text-right">{usd(l.lineTotal)}</TableCell>
                  <TableCell className="text-right">{usd(l.allocatedExtra)}</TableCell>
                  <TableCell className="text-right">{usd(l.landedTotal)}</TableCell>
                  <TableCell className="text-right">{usd(l.landedUnitCostBase, 6)} / {l.baseUnit}</TableCell>
                  <TableCell className="text-right">{Number(l.returnedQty) > 0 ? `${num(l.returnedQty)} ${l.unitLabel}` : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Totals</CardTitle></CardHeader>
            <CardContent className="grid gap-1 text-sm">
              <div className="flex justify-between"><span>Items</span><span>{usd(r.subtotal)}</span></div>
              {r.extraCosts.map((e) => <div key={e.id} className="flex justify-between"><span>{e.description}</span><span>{usd(e.amount)}</span></div>)}
              <div className="flex justify-between font-semibold"><span>Total</span><span>{usd(r.total)}</span></div>
              {Number(r.returnedTotal) > 0 && <div className="flex justify-between"><span>Returned</span><span>{usd(r.returnedTotal)}</span></div>}
              <div className="flex justify-between"><span>Paid / credited</span><span>{usd(r.amountPaid)}</span></div>
              <div className="flex justify-between font-medium"><span>Still due</span><span>{usd(r.amountDue)}</span></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Payments and returns</CardTitle></CardHeader>
            <CardContent className="grid gap-1 text-sm">
              {r.allocations.map((a) => (
                <div key={a.id} className="flex justify-between">
                  <span>{a.paymentDate} · {a.kind === "return_credit" ? "Return credit" : (a.method ?? "Payment")}{a.currencyCode !== "USD" ? ` (${Number(a.amount).toLocaleString()} ${a.currencyCode})` : ""}</span>
                  <span>{usd(a.amountBase)}</span>
                </div>
              ))}
              {r.returns.map((x) => (
                <div key={x.id} className="flex justify-between text-muted-foreground">
                  <span>Return #{x.number} · {x.returnDate} · {x.reason}{x.refundAmount ? " (refunded)" : ""}</span><span>−{usd(x.total)}</span>
                </div>
              ))}
              {r.allocations.length === 0 && r.returns.length === 0 && <p className="text-muted-foreground">Nothing yet.</p>}
            </CardContent>
          </Card>
        </div>
        {r.note && <p className="text-sm text-muted-foreground">Note: {r.note}</p>}
      </div>
    </>
  );
}
