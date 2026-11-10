"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ItemPicker } from "./item-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { liveRecipeCost, rehydrateRecipeLine } from "@/lib/domain/recipe";
import { usd } from "@/lib/format";
import type { RecipeItem } from "@/lib/queries/menu";

export type RecipeLineState = { key: string; itemId: string; unitKey: string; qty: string };

let seq = 0;
export const newLine = (): RecipeLineState => ({ key: `n${++seq}`, itemId: "", unitKey: "base", qty: "" });

/** Rebuild editor lines from saved recipe rows (see rehydrateRecipeLine: never changes the base quantity). */
export function linesFromRecipe(recipe: { itemId: string; unitLabel: string; unitFactor: string; qtyEntered: string; qtyBase: string }[], items: RecipeItem[]): RecipeLineState[] {
  return recipe.map((r) => ({ key: `n${++seq}`, ...rehydrateRecipeLine(r, items) }));
}

export const recipeInput = (lines: RecipeLineState[]) =>
  lines.filter((l) => l.itemId && l.qty.trim()).map((l) => ({ itemId: l.itemId, unitKey: l.unitKey, qty: l.qty.trim() }));

/**
 * Recipe lines (item, quantity, unit) with a live cost per line and in total.
 * `allowNegative` is for modifiers that replace an ingredient (−200 ml milk).
 */
export function RecipeEditor({
  items, lines, onChange, showCost, allowNegative = false, label, disabled = false,
}: {
  items: RecipeItem[]; lines: RecipeLineState[]; onChange: (lines: RecipeLineState[]) => void;
  showCost: boolean; allowNegative?: boolean; label: string; disabled?: boolean;
}) {
  const update = (i: number, patch: Partial<RecipeLineState>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const live = liveRecipeCost(lines, items);
  const missing = items.filter((i) => live.missingItemIds.includes(i.id)).map((i) => i.name);

  return (
    <div className="grid gap-2">
      {lines.length === 0 && <p className="text-sm text-muted-foreground">No recipe — selling this won&apos;t use any stock.</p>}
      {lines.map((l, i) => {
        const item = items.find((x) => x.id === l.itemId);
        return (
          <div key={l.key} className="grid grid-cols-[minmax(0,1fr)_6rem_7rem_5.5rem_2.25rem] items-center gap-2">
            <ItemPicker items={items} value={l.itemId} label={`${label} item ${i + 1}`} disabled={disabled} onChange={(v) => update(i, { itemId: v, unitKey: "base" })} />
            <Input
              aria-label={`${label} quantity ${i + 1}`} inputMode="decimal" value={l.qty} placeholder={allowNegative ? "e.g. -200" : "Qty"}
              onChange={(e) => update(i, { qty: e.target.value })}
            />
            <Select value={l.unitKey} onValueChange={(v) => update(i, { unitKey: v })} disabled={!item || disabled}>
              <SelectTrigger className="w-full" aria-label={`${label} unit ${i + 1}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                {(item?.unitOptions ?? [{ key: "base", label: "unit", factor: "1" }]).map((u) => <SelectItem key={u.key} value={u.key}>{u.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="text-right text-sm tabular-nums text-muted-foreground">{showCost ? usd(live.lineCosts[i], 4) : ""}</span>
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${label} line ${i + 1}`} onClick={() => onChange(lines.filter((_, j) => j !== i))}>
              <Trash2 />
            </Button>
          </div>
        );
      })}
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...lines, newLine()])}><Plus /> Add ingredient</Button>
        {showCost && (
          <span className="text-sm">
            Cost <span className="font-medium tabular-nums">{usd(live.cost, 4)}</span>
            {missing.length > 0 && <span className="ml-2 text-amber-600">No cost yet: {missing.join(", ")}</span>}
          </span>
        )}
      </div>
    </div>
  );
}
