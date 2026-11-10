"use client";

import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { checkModifierSelection } from "@/lib/domain/modifiers";
import { dec } from "@/lib/domain/money";
import { usd } from "@/lib/format";
import type { CartModifier } from "@/lib/pos/cart-store";
import type { PosMenu } from "@/lib/queries/pos";
import { cn } from "@/lib/utils";

type Product = PosMenu["products"][number];
type Group = PosMenu["groups"][number];

/** Variant chips, modifier groups (enforcing min/max), qty and note (plan §6). */
export function ProductDialog({
  product, groups, onClose, onAdd,
}: {
  product: Product; groups: Group[]; onClose: () => void;
  onAdd: (v: { variantId: string; variantName: string; unitPrice: string; qty: number; modifiers: CartModifier[]; note: string }) => void;
}) {
  const available = product.variants.filter((v) => v.isAvailable);
  const [variantId, setVariantId] = useState((available.find((v) => v.isDefault) ?? available[0])?.id ?? "");
  const [picked, setPicked] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const myGroups = product.groupIds.map((id) => groups.find((g) => g.id === id)).filter((g): g is Group => Boolean(g));
  const variant = product.variants.find((v) => v.id === variantId);
  const chosen = myGroups.flatMap((g) => g.modifiers.filter((m) => picked.includes(m.id)).map((m) => ({ id: m.id, groupId: g.id, name: m.name, priceDelta: m.priceDelta })));
  const problems = myGroups.map((g) => checkModifierSelection(g, chosen.filter((m) => m.groupId === g.id).length)).filter(Boolean) as string[];
  const each = chosen.reduce((a, m) => a.plus(m.priceDelta), dec(variant?.price ?? 0));

  const toggle = (g: Group, id: string) => {
    const inGroup = g.modifiers.map((m) => m.id);
    const current = picked.filter((p) => inGroup.includes(p));
    if (picked.includes(id)) return setPicked(picked.filter((p) => p !== id));
    // Single-choice groups behave like radio buttons.
    if (g.maxSelect === 1) return setPicked([...picked.filter((p) => !inGroup.includes(p)), id]);
    if (current.length >= g.maxSelect) return;
    setPicked([...picked, id]);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{product.name}</DialogTitle></DialogHeader>
        <div className="grid gap-4">
          {product.variants.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {product.variants.map((v) => (
                <Button key={v.id} type="button" variant={v.id === variantId ? "default" : "outline"} className="h-12 min-w-24" disabled={!v.isAvailable} onClick={() => setVariantId(v.id)}>
                  {v.name} · {usd(v.price)}{!v.isAvailable && " (sold out)"}
                </Button>
              ))}
            </div>
          )}
          {myGroups.map((g) => {
            const count = chosen.filter((m) => m.groupId === g.id).length;
            return (
              <div key={g.id} className="grid gap-2">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">{g.name}</span>
                  <span className={cn("text-muted-foreground", g.minSelect > count && "text-amber-600")}>
                    {g.minSelect >= 1 ? `Required · choose ${g.minSelect === g.maxSelect ? g.minSelect : `${g.minSelect}–${g.maxSelect}`}` : `Optional · up to ${g.maxSelect}`}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {g.modifiers.map((m) => (
                    <Button key={m.id} type="button" variant={picked.includes(m.id) ? "default" : "outline"} className="h-11" aria-pressed={picked.includes(m.id)} onClick={() => toggle(g, m.id)}>
                      {m.name}{Number(m.priceDelta) !== 0 && ` ${Number(m.priceDelta) > 0 ? "+" : ""}${usd(m.priceDelta)}`}
                    </Button>
                  ))}
                </div>
              </div>
            );
          })}
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="icon" className="size-11" aria-label="Decrease quantity" onClick={() => setQty((q) => Math.max(1, q - 1))}><Minus /></Button>
            <span className="w-8 text-center text-lg tabular-nums" aria-label="Quantity">{qty}</span>
            <Button type="button" variant="outline" size="icon" className="size-11" aria-label="Increase quantity" onClick={() => setQty((q) => Math.min(999, q + 1))}><Plus /></Button>
            <Input className="h-11" placeholder="Note (e.g. less ice)" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="items-center gap-2">
          {problems[0] && <span className="mr-auto text-sm text-amber-600">{problems[0]}</span>}
          <Button size="lg" className="h-12" disabled={!variant || problems.length > 0}
            onClick={() => onAdd({ variantId, variantName: variant!.name, unitPrice: variant!.price, qty, modifiers: chosen, note: note.trim() })}>
            Add · {usd(each.times(qty).toString())}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
