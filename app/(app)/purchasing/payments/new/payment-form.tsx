"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { openReceiptsAction, recordSupplierPaymentAction } from "@/app/(app)/purchasing/actions";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { autoAllocate } from "@/lib/domain/allocation";
import { dec, sum } from "@/lib/domain/money";
import { usd } from "@/lib/format";
import type { OpenReceipt } from "@/lib/queries/purchasing";

const isNum = (v: string) => /^\d+(\.\d+)?$/.test(v.trim());

export function PaymentForm({ branchId, suppliers, methods, today, presetSupplierId }: {
  branchId: string; suppliers: { id: string; name: string; owed: string }[]; methods: { id: string; name: string }[]; today: string; presetSupplierId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [supplierId, setSupplierId] = useState(presetSupplierId);
  const [open, setOpen] = useState<OpenReceipt[]>([]);
  const [date, setDate] = useState(today);
  const [methodId, setMethodId] = useState(methods.find((m) => m.name === "Bank transfer")?.id ?? methods[0]?.id ?? "");
  const [currency, setCurrency] = useState("USD");
  const [rate, setRate] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  /** Set once the user edits an allocation by hand; until then it follows the amount (oldest first). */
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!supplierId) return;
    let cancelled = false;
    openReceiptsAction(supplierId).then((r) => {
      if (!cancelled && r.ok) { setOpen(r.data); setTouched(false); }
    });
    return () => { cancelled = true; };
  }, [supplierId]);

  const amountBase = isNum(amount) ? (currency === "USD" ? dec(amount) : isNum(rate) && dec(rate).gt(0) ? dec(amount).div(rate).toDecimalPlaces(4) : null) : null;
  const auto = (base: ReturnType<typeof dec> | null) =>
    base ? Object.fromEntries(autoAllocate(base, open.map((r) => ({ receiptId: r.id, amountDue: r.amountDue }))).allocations.map((x) => [x.receiptId, String(Number(x.amount))])) : {};
  // Until edited by hand, the allocation is always derived from the amount and the loaded invoices.
  const effective = touched ? alloc : auto(amountBase);
  const autoFill = (base: ReturnType<typeof dec> | null) => { setAlloc(auto(base)); setTouched(false); };
  const allocated = sum(Object.values(effective).filter(isNum));
  const unallocated = amountBase ? amountBase.minus(allocated) : null;

  return (
    <div className="grid max-w-4xl gap-4">
      <Card>
        <CardContent className="grid gap-3 pt-6 md:grid-cols-3">
          <Field label="Supplier">
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger className="w-full" aria-label="Supplier"><SelectValue placeholder="Choose supplier…" /></SelectTrigger>
              <SelectContent>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}{Number(s.owed) > 0 ? ` — owes ${usd(s.owed)}` : ""}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Method">
            <Select value={methodId} onValueChange={setMethodId}>
              <SelectTrigger className="w-full" aria-label="Method"><SelectValue /></SelectTrigger>
              <SelectContent>{methods.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Currency">
            <Select value={currency} onValueChange={(v) => { setCurrency(v); setTouched(false); }}>
              <SelectTrigger className="w-full" aria-label="Currency"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="KHR">KHR (riel)</SelectItem></SelectContent>
            </Select>
          </Field>
          {currency !== "USD" && <Field label="Rate (riel per $1)"><Input inputMode="decimal" placeholder="4100" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>}
          <Field label={`Amount (${currency})`}>
            <Input inputMode="decimal" aria-label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Reference (optional)"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Bank ref, cheque no." /></Field>
        </CardContent>
      </Card>

      {supplierId && (
        <div className="rounded-md border">
          <Table>
            <TableHeader><TableRow><TableHead>Receipt</TableHead><TableHead>Date</TableHead><TableHead>Due</TableHead><TableHead className="text-right">Due now</TableHead><TableHead className="w-36 text-right">Pay (USD)</TableHead></TableRow></TableHeader>
            <TableBody>
              {open.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>GR-{String(r.number).padStart(6, "0")}{r.supplierInvoiceNo ? ` · ${r.supplierInvoiceNo}` : ""}</TableCell>
                  <TableCell>{r.receiptDate}</TableCell>
                  <TableCell>{r.dueDate ?? "—"}</TableCell>
                  <TableCell className="text-right">{usd(r.amountDue)}</TableCell>
                  <TableCell className="text-right">
                    <Input className="ml-auto w-28 text-right" inputMode="decimal" aria-label={`Pay GR-${r.number}`} value={effective[r.id] ?? ""} onChange={(e) => { setAlloc({ ...effective, [r.id]: e.target.value }); setTouched(true); }} />
                  </TableCell>
                </TableRow>
              ))}
              {open.length === 0 && <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No open invoices — the whole payment will be supplier credit.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
        {amountBase && <span>Payment: {usd(amountBase.toFixed(2))}</span>}
        <span>Allocated: {usd(allocated.toFixed(2))}</span>
        {unallocated && <span className={unallocated.isNegative() ? "text-destructive" : "text-muted-foreground"}>{unallocated.isNegative() ? "Over-allocated" : `Left as credit: ${usd(unallocated.toFixed(2))}`}</span>}
        <Button variant="outline" disabled={!amountBase || !open.length} onClick={() => autoFill(amountBase)}>Oldest first</Button>
        <Button
          disabled={pending || !supplierId || !amountBase || !!unallocated?.isNegative()}
          onClick={() =>
            start(async () => {
              const r = await recordSupplierPaymentAction({
                branchId, supplierId, paymentDate: date, methodId, currencyCode: currency, rate: currency === "USD" ? null : rate, amount, reference: reference || null,
                allocations: Object.entries(effective).filter(([, v]) => isNum(v) && dec(v).gt(0)).map(([receiptId, a]) => ({ receiptId, amount: a })),
              });
              if (r.ok) { toast.success("Payment recorded."); router.push(`/purchasing/suppliers/${supplierId}`); router.refresh(); } else toast.error(r.error);
            })
          }
        >
          Record payment
        </Button>
      </div>
    </div>
  );
}
