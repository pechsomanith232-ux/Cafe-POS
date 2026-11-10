"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { saveCustomerAction } from "./actions";

type C = { id: string; name: string; phone: string | null; creditLimit: string | null; note: string | null; isActive: boolean };

export function CustomerDialog({ customer, onClose }: { customer: C | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [limit, setLimit] = useState(customer?.creditLimit ? String(Number(customer.creditLimit)) : "");
  const [note, setNote] = useState(customer?.note ?? "");
  const [isActive, setIsActive] = useState(customer?.isActive ?? true);
  const save = () => start(async () => {
    const r = await saveCustomerAction(customer?.id ?? null, { name, phone, creditLimit: limit.trim() || null, note, isActive });
    if (!r.ok) return void toast.error(r.error);
    toast.success("Customer saved.");
    onClose();
    router.refresh();
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{customer ? `Edit ${customer.name}` : "New customer"}</DialogTitle>
          <DialogDescription>Give a credit limit to let the POS charge orders to this customer&apos;s account.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
            <Field label="Credit limit (USD)"><Input inputMode="decimal" placeholder="No account" value={limit} onChange={(e) => setLimit(e.target.value)} /></Field>
          </div>
          <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {customer && <div className="flex items-center gap-3"><Switch id="cust-active" checked={isActive} onCheckedChange={setIsActive} /><Label htmlFor="cust-active">Active</Label></div>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={pending}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
