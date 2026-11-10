"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { allocateSupplierCreditAction, updateSupplierAction } from "@/app/(app)/purchasing/actions";
import { SupplierDialog, type SupplierFormValue } from "@/components/purchasing/supplier-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { autoAllocate } from "@/lib/domain/allocation";
import { dec, sum } from "@/lib/domain/money";
import { usd } from "@/lib/format";
import type { OpenReceipt } from "@/lib/queries/purchasing";

export function SupplierActions({ supplier }: { supplier: SupplierFormValue }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="outline" onClick={() => setEditing(true)}>Edit</Button>
      <Button
        variant="ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await updateSupplierAction(supplier.id, { ...supplier, isActive: !supplier.isActive });
            if (r.ok) { toast.success(supplier.isActive ? "Supplier deactivated." : "Supplier activated."); router.refresh(); } else toast.error(r.error);
          })
        }
      >
        {supplier.isActive ? "Deactivate" : "Activate"}
      </Button>
      {editing && <SupplierDialog supplier={supplier} onClose={() => setEditing(false)} />}
    </>
  );
}

export function AllocateCredit({ paymentId, unallocated, open }: { paymentId: string; unallocated: string; open: OpenReceipt[] }) {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const initial = () => Object.fromEntries(autoAllocate(unallocated, open.map((r) => ({ receiptId: r.id, amountDue: r.amountDue }))).allocations.map((a) => [a.receiptId, String(Number(a.amount))]));
  const [amounts, setAmounts] = useState<Record<string, string>>(initial);
  const [pending, start] = useTransition();
  const total = sum(Object.values(amounts).filter((v) => /^\d+(\.\d+)?$/.test(v)));
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { setAmounts(initial()); setShow(true); }}>Apply credit</Button>
      <Dialog open={show} onOpenChange={setShow}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Apply unused credit</DialogTitle>
            <DialogDescription>{usd(unallocated)} available. Oldest invoices first; edit the amounts if needed.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {open.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                <span>GR-{String(r.number).padStart(6, "0")} · due {usd(r.amountDue)}</span>
                <Input className="w-28" inputMode="decimal" value={amounts[r.id] ?? ""} onChange={(e) => setAmounts((a) => ({ ...a, [r.id]: e.target.value }))} aria-label={`Apply to GR-${r.number}`} />
              </div>
            ))}
          </div>
          <DialogFooter>
            <span className={`mr-auto text-sm ${total.gt(unallocated) ? "text-destructive" : "text-muted-foreground"}`}>Applying {usd(total.toFixed(2))}</span>
            <Button
              disabled={pending || total.lte(0) || total.gt(unallocated)}
              onClick={() =>
                start(async () => {
                  const allocations = Object.entries(amounts).filter(([, v]) => /^\d+(\.\d+)?$/.test(v) && dec(v).gt(0)).map(([receiptId, amount]) => ({ receiptId, amount }));
                  const r = await allocateSupplierCreditAction(paymentId, allocations);
                  if (r.ok) { toast.success("Credit applied."); setShow(false); router.refresh(); } else toast.error(r.error);
                })
              }
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
