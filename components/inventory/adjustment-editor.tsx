"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteAdjustmentAction, postAdjustmentAction, saveAdjustmentAction } from "@/app/(app)/inventory/actions";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { REASON_LABELS } from "@/lib/format";
import type { ItemOption } from "@/lib/queries/inventory";
import { ADJUSTMENT_REASONS } from "@/lib/validators/inventory";

type Line = { itemId: string; direction: "out" | "in"; qty: string; unitKey: string; unitCost: string };
export type AdjustmentDraft = { id: string; reasonCode: string; note: string | null; lines: { itemId: string; qty: string; unitKey: string; unitCost: string }[] };

const emptyLine = (): Line => ({ itemId: "", direction: "out", qty: "", unitKey: "base", unitCost: "" });

export function AdjustmentEditor({ branchId, items, draft }: { branchId: string; items: ItemOption[]; draft?: AdjustmentDraft }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reasonCode, setReasonCode] = useState(draft?.reasonCode ?? "waste");
  const [note, setNote] = useState(draft?.note ?? "");
  const [lines, setLines] = useState<Line[]>(
    draft?.lines.map((l) => ({
      itemId: l.itemId, direction: Number(l.qty) < 0 ? "out" : "in", qty: String(Math.abs(Number(l.qty))), unitKey: l.unitKey, unitCost: l.unitCost,
    })) ?? [emptyLine()],
  );
  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const input = () => ({
    branchId, reasonCode: reasonCode as "waste", note,
    lines: lines.filter((l) => l.itemId).map((l) => ({
      itemId: l.itemId, unitKey: l.unitKey,
      qty: l.direction === "out" ? `-${l.qty}` : l.qty,
      unitCost: l.direction === "in" && l.unitCost ? l.unitCost : null,
    })),
  });

  const save = (thenPost: boolean) =>
    start(async () => {
      const r = await saveAdjustmentAction(draft?.id ?? null, input());
      if (!r.ok) return void toast.error(r.error);
      if (thenPost) {
        if (!confirm("Post this adjustment? Stock changes immediately and it can't be edited afterwards.")) {
          router.push(`/inventory/adjustments/${r.data.id}`);
          return;
        }
        const p = await postAdjustmentAction(r.data.id);
        if (!p.ok) return void toast.error(p.error);
        toast.success("Adjustment posted.");
      } else toast.success("Draft saved.");
      router.push(`/inventory/adjustments/${r.data.id}`);
      router.refresh();
    });

  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Reason">
            <Select value={reasonCode} onValueChange={setReasonCode}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{ADJUSTMENT_REASONS.map((r) => <SelectItem key={r} value={r}>{REASON_LABELS[r]}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Field label={reasonCode === "other" ? "Note (required)" : "Note"}>
              <Textarea rows={1} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened?" />
            </Field>
          </div>
        </div>
        <div className="grid gap-2">
          <div className="hidden grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-2 text-xs font-medium text-muted-foreground md:grid">
            <span>Item</span><span>Remove / add</span><span>Quantity</span><span>Unit</span><span>Cost per unit (additions)</span><span />
          </div>
          {lines.map((l, i) => {
            const item = items.find((it) => it.id === l.itemId);
            return (
              <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
                <Select value={l.itemId} onValueChange={(v) => update(i, { itemId: v, unitKey: "base" })}>
                  <SelectTrigger className="col-span-2 w-full md:col-span-1" aria-label="Item"><SelectValue placeholder="Choose item…" /></SelectTrigger>
                  <SelectContent>{items.map((it) => <SelectItem key={it.id} value={it.id}>{it.name}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={l.direction} onValueChange={(v) => update(i, { direction: v as Line["direction"] })}>
                  <SelectTrigger className="w-full" aria-label="Direction"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="out">Remove −</SelectItem><SelectItem value="in">Add +</SelectItem></SelectContent>
                </Select>
                <Input inputMode="decimal" aria-label="Quantity" value={l.qty} onChange={(e) => update(i, { qty: e.target.value })} />
                <Select value={l.unitKey} onValueChange={(v) => update(i, { unitKey: v })} disabled={!item}>
                  <SelectTrigger className="w-full" aria-label="Unit"><SelectValue /></SelectTrigger>
                  <SelectContent>{(item?.unitOptions ?? [{ key: "base", label: "unit", factor: "1" }]).map((u) => <SelectItem key={u.key} value={u.key}>{u.label}</SelectItem>)}</SelectContent>
                </Select>
                <Input inputMode="decimal" aria-label="Cost per unit" placeholder={l.direction === "in" ? "avg if empty" : "—"} disabled={l.direction === "out"} value={l.unitCost} onChange={(e) => update(i, { unitCost: e.target.value })} />
                <Button variant="ghost" size="icon" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>
            );
          })}
          <Button variant="outline" className="w-fit" onClick={() => setLines((ls) => [...ls, emptyLine()])}><Plus /> Add line</Button>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {draft && (
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() =>
                confirm("Delete this draft?") &&
                start(async () => {
                  const r = await deleteAdjustmentAction(draft.id);
                  if (r.ok) { toast.success("Draft deleted."); router.push("/inventory/adjustments"); } else toast.error(r.error);
                })
              }
            >
              Delete draft
            </Button>
          )}
          <Button variant="outline" disabled={pending} onClick={() => save(false)}>Save draft</Button>
          <Button disabled={pending} onClick={() => save(true)}>Save &amp; post</Button>
        </div>
      </CardContent>
    </Card>
  );
}
