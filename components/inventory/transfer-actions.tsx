"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { cancelTransferAction, receiveTransferAction, sendTransferAction } from "@/app/(app)/inventory/transfers/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { num } from "@/lib/format";

/** Send / cancel a draft (sending branch). */
export function DraftActions({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => start(async () => {
    const r = await fn();
    if (!r.ok) return void toast.error(r.error);
    toast.success(done);
    router.refresh();
  });
  return (
    <div className="flex gap-2">
      <Button variant="ghost" disabled={pending} onClick={() => confirm("Cancel this draft?") && run(() => cancelTransferAction(id), "Transfer cancelled.")}>Cancel draft</Button>
      <Button disabled={pending} onClick={() => confirm("Send now? The stock leaves this branch immediately.") && run(() => sendTransferAction(id), "Transfer sent.")}>Send</Button>
    </div>
  );
}

/** Receive (destination branch): quantities default to what was sent; less is recorded as loss. */
export function ReceiveForm({ id, lines }: { id: string; lines: { id: string; item: string; unit: string; qtySent: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [qty, setQty] = useState<Record<string, string>>(Object.fromEntries(lines.map((l) => [l.id, String(Number(l.qtySent))])));
  const receive = () => start(async () => {
    const r = await receiveTransferAction(id, { lines: lines.map((l) => ({ lineId: l.id, qtyReceived: qty[l.id] ?? "" })) });
    if (!r.ok) return void toast.error(r.error);
    toast.success("Transfer received.");
    router.refresh();
  });
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">Count what arrived. Anything short is recorded as a loss on this transfer.</p>
      {lines.map((l) => (
        <label key={l.id} className="grid grid-cols-[1fr_8rem_4rem] items-center gap-2 text-sm">
          <span>{l.item} <span className="text-muted-foreground">(sent {num(l.qtySent)} {l.unit})</span></span>
          <Input inputMode="decimal" aria-label={`Received ${l.item}`} value={qty[l.id]} onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))} />
          <span className="text-muted-foreground">{l.unit}</span>
        </label>
      ))}
      <div><Button disabled={pending} onClick={receive}>Receive</Button></div>
    </div>
  );
}
