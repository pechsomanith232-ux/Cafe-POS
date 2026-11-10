"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createTransferAction } from "@/app/(app)/inventory/transfers/actions";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ItemOption } from "@/lib/queries/inventory";

type Line = { itemId: string; qty: string; unitKey: string };
const emptyLine = (): Line => ({ itemId: "", qty: "", unitKey: "base" });

export function TransferEditor({ fromBranchId, targets, items }: { fromBranchId: string; targets: { id: string; name: string }[]; items: ItemOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [to, setTo] = useState(targets.length === 1 ? targets[0].id : "");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const save = (send: boolean) => start(async () => {
    if (send && !confirm("Send now? The stock leaves this branch immediately.")) return;
    const r = await createTransferAction({ fromBranchId, toBranchId: to, note, lines: lines.filter((l) => l.itemId) }, send);
    if (!r.ok) return void toast.error(r.error);
    toast.success(send ? "Transfer sent." : "Draft saved.");
    router.push(`/inventory/transfers/${r.data.id}`);
  });
  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Send to">
            <Select value={to} onValueChange={setTo}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose branch…" /></SelectTrigger>
              <SelectContent>{targets.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <div className="md:col-span-2"><Field label="Note"><Textarea rows={1} value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
        </div>
        <div className="grid gap-2">
          {lines.map((l, i) => {
            const item = items.find((it) => it.id === l.itemId);
            return (
              <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-[2fr_1fr_1fr_auto]">
                <Select value={l.itemId} onValueChange={(v) => update(i, { itemId: v, unitKey: "base" })}>
                  <SelectTrigger className="col-span-2 w-full md:col-span-1" aria-label="Item"><SelectValue placeholder="Choose item…" /></SelectTrigger>
                  <SelectContent>{items.map((it) => <SelectItem key={it.id} value={it.id}>{it.name}</SelectItem>)}</SelectContent>
                </Select>
                <Input inputMode="decimal" aria-label="Quantity" placeholder="Qty" value={l.qty} onChange={(e) => update(i, { qty: e.target.value })} />
                <Select value={l.unitKey} onValueChange={(v) => update(i, { unitKey: v })} disabled={!item}>
                  <SelectTrigger className="w-full" aria-label="Unit"><SelectValue /></SelectTrigger>
                  <SelectContent>{(item?.unitOptions ?? [{ key: "base", label: "unit", factor: "1" }]).map((u) => <SelectItem key={u.key} value={u.key}>{u.label}</SelectItem>)}</SelectContent>
                </Select>
                <Button variant="ghost" size="icon" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>
            );
          })}
          <Button variant="outline" className="w-fit" onClick={() => setLines((ls) => [...ls, emptyLine()])}><Plus /> Add line</Button>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={pending || !to} onClick={() => save(false)}>Save draft</Button>
          <Button disabled={pending || !to} onClick={() => save(true)}>Save &amp; send</Button>
        </div>
      </CardContent>
    </Card>
  );
}
