"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createSupplierReturnAction } from "@/app/(app)/purchasing/actions";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dec, sum } from "@/lib/domain/money";
import { num, usd } from "@/lib/format";
import type { ReceiptDetail } from "@/lib/queries/purchasing";

const isNum = (v: string) => /^\d+(\.\d+)?$/.test(v.trim());

export function ReturnDialog({ receipt, methods, today }: { receipt: ReceiptDetail; methods: { id: string; name: string }[]; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(today);
  const [methodId, setMethodId] = useState(methods[0]?.id ?? "");
  const [currency, setCurrency] = useState("USD");
  const [rate, setRate] = useState("");
  const [pending, start] = useTransition();
  const direct = receipt.purchaseType === "direct";
  const value = sum(receipt.lines.map((l) => (isNum(qty[l.id] ?? "") ? dec(l.landedTotal).times(qty[l.id]).div(l.qtyEntered) : dec(0))));

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>Return to supplier</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Return to supplier</DialogTitle>
            <DialogDescription>
              Stock goes out at what it cost on this receipt. {direct ? "Record the refund you received." : "The value is credited against this invoice (any extra becomes supplier credit)."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {receipt.lines.map((l) => {
              const left = dec(l.qtyEntered).minus(l.returnedQty);
              return (
                <div key={l.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{l.itemName} <span className="text-muted-foreground">({num(left.toString())} {l.unitLabel} left)</span></span>
                  <div className="flex items-center gap-1">
                    <Input className="w-24" inputMode="decimal" aria-label={`Return ${l.itemName}`} disabled={left.lte(0)} value={qty[l.id] ?? ""} onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))} />
                    <span className="w-14 text-muted-foreground">{l.unitLabel}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Sour, damaged…" /></Field>
            <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
          {direct && (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Refund method">
                <Select value={methodId} onValueChange={setMethodId}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{methods.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Currency">
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="KHR">KHR</SelectItem></SelectContent>
                </Select>
              </Field>
              {currency !== "USD" && <Field label="Rate"><Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="4100" /></Field>}
            </div>
          )}
          <DialogFooter>
            <span className="mr-auto text-sm text-muted-foreground">Return value: {usd(value.toFixed(2))}</span>
            <Button
              disabled={pending || value.lte(0) || !reason.trim()}
              onClick={() =>
                start(async () => {
                  const r = await createSupplierReturnAction({
                    receiptId: receipt.id, returnDate: date, reason,
                    lines: Object.entries(qty).filter(([, v]) => isNum(v) && dec(v).gt(0)).map(([receiptLineId, q]) => ({ receiptLineId, qty: q })),
                    refund: direct ? { methodId, currencyCode: currency, rate: currency === "USD" ? null : rate } : null,
                  });
                  if (r.ok) { toast.success("Return recorded."); setOpen(false); router.refresh(); } else toast.error(r.error);
                })
              }
            >
              Post return
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
