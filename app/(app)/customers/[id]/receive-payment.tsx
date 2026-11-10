"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usd } from "@/lib/format";
import { customerPaymentAction } from "../actions";

export function ReceivePayment({ customerId, branchId, methods, drawers, owes }: {
  customerId: string; branchId: string; methods: { id: string; name: string; type: string }[]; drawers: { registerId: string; name: string }[]; owes: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [methodId, setMethodId] = useState(methods.find((m) => m.type === "cash")?.id ?? methods[0]?.id ?? "");
  const [currency, setCurrency] = useState("USD");
  const [amount, setAmount] = useState(Number(owes) > 0 ? Number(owes).toFixed(2) : "");
  const [registerId, setRegisterId] = useState(drawers[0]?.registerId ?? "");
  const [reference, setReference] = useState("");
  const [pending, start] = useTransition();
  const isCash = methods.find((m) => m.id === methodId)?.type === "cash";
  const save = () => start(async () => {
    const r = await customerPaymentAction({ customerId, branchId, registerId: isCash ? registerId || null : null, methodId, currencyCode: currency, amount: amount.trim(), reference });
    if (!r.ok) return void toast.error(r.error);
    toast.success("Payment recorded.");
    setOpen(false);
    router.refresh();
  });
  return (
    <>
      <Button onClick={() => setOpen(true)}>Receive payment</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Receive payment</DialogTitle><DialogDescription>Owes {usd(owes)}. Paid off oldest orders first; anything extra stays as credit.</DialogDescription></DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Method">
                <Select value={methodId} onValueChange={setMethodId}>
                  <SelectTrigger className="w-full" aria-label="Payment method"><SelectValue /></SelectTrigger>
                  <SelectContent>{methods.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Currency">
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger className="w-full" aria-label="Currency"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="KHR">Riel</SelectItem></SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Amount"><Input aria-label="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            {isCash && (
              drawers.length === 0 ? <p className="text-sm text-amber-700">Cash needs an open shift — open one at the POS first.</p> : drawers.length > 1 && (
                <Field label="Into drawer">
                  <Select value={registerId} onValueChange={setRegisterId}>
                    <SelectTrigger className="w-full" aria-label="Drawer"><SelectValue /></SelectTrigger>
                    <SelectContent>{drawers.map((d) => <SelectItem key={d.registerId} value={d.registerId}>{d.name}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              )
            )}
            <Field label="Reference (optional)"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={pending || !amount.trim() || (isCash && !registerId)}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
