"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveModifierGroupAction } from "@/app/(app)/menu/actions";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { usd } from "@/lib/format";
import type { ModifierGroupDetail, RecipeItem } from "@/lib/queries/menu";
import { linesFromRecipe, RecipeEditor, recipeInput, type RecipeLineState } from "./recipe-editor";

type Option = { key: string; id?: string; name: string; priceDelta: string; deductStock: boolean; lines: RecipeLineState[] };
let seq = 0;
const blank = (): Option => ({ key: `m${++seq}`, name: "", priceDelta: "0", deductStock: true, lines: [] });

export function ModifierGroupForm({ group, items, showCost, canEdit }: { group?: ModifierGroupDetail; items: RecipeItem[]; showCost: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const uid = useId();
  const [name, setName] = useState(group?.name ?? "");
  const [minSelect, setMin] = useState(String(group?.minSelect ?? 0));
  const [maxSelect, setMax] = useState(String(group?.maxSelect ?? 1));
  const [isActive, setIsActive] = useState(group?.isActive ?? true);
  const [options, setOptions] = useState<Option[]>(
    group?.modifiers.map((m) => ({ key: m.id, id: m.id, name: m.name, priceDelta: String(Number(m.priceDelta)), deductStock: m.deductStock, lines: linesFromRecipe(m.recipe, items) })) ?? [blank()],
  );
  const update = (i: number, patch: Partial<Option>) => setOptions((os) => os.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const min = Number(minSelect), max = Number(maxSelect);
  const rule = Number.isInteger(min) && Number.isInteger(max)
    ? min >= 1 ? `Required: the cashier must choose ${min === max ? min : `${min} to ${max}`}.` : `Optional: up to ${max}.`
    : "";

  const save = () =>
    start(async () => {
      const r = await saveModifierGroupAction(group?.id ?? null, {
        name, minSelect: Number(minSelect), maxSelect: Number(maxSelect), isActive,
        modifiers: options.map((o) => ({ id: o.id, name: o.name, priceDelta: o.priceDelta || "0", deductStock: o.deductStock, recipe: recipeInput(o.lines) })),
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(group ? "Modifier group saved." : "Modifier group added.");
      if (!group) router.push(`/menu/modifiers/${r.data.id}`);
      router.refresh();
    });

  return (
    <fieldset disabled={!canEdit || pending} className="grid gap-4">
      <Card>
        <CardHeader><CardTitle>Group</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Milk" /></Field>
          <Field label="Min to choose"><Input aria-label="Min to choose" inputMode="numeric" value={minSelect} onChange={(e) => setMin(e.target.value)} /></Field>
          <Field label="Max to choose"><Input aria-label="Max to choose" inputMode="numeric" value={maxSelect} onChange={(e) => setMax(e.target.value)} /></Field>
          <div className="flex items-end gap-3 pb-2">
            <Switch id={`${uid}-active`} checked={isActive} onCheckedChange={setIsActive} /><Label htmlFor={`${uid}-active`}>Active</Label>
          </div>
          <p className="text-sm text-muted-foreground md:col-span-4">{rule}</p>
        </CardContent>
      </Card>

      {options.map((o, i) => (
        <Card key={o.key}>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>Option: {o.name || "(unnamed)"} {Number(o.priceDelta) !== 0 && <span className="font-normal text-muted-foreground">{Number(o.priceDelta) > 0 ? "+" : ""}{usd(o.priceDelta)}</span>}</CardTitle>
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove option ${o.name}`} onClick={() => setOptions((os) => os.filter((_, j) => j !== i))}><Trash2 /></Button>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Field label="Name"><Input aria-label={`Option ${i + 1} name`} value={o.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="e.g. Oat milk" /></Field>
              <Field label="Price change (USD)"><Input aria-label={`Option ${i + 1} price change`} inputMode="decimal" value={o.priceDelta} onChange={(e) => update(i, { priceDelta: e.target.value })} /></Field>
              <div className="flex items-end gap-3 pb-2">
                <Switch id={`${uid}-deduct-${o.key}`} checked={o.deductStock} onCheckedChange={(d) => update(i, { deductStock: d })} />
                <Label htmlFor={`${uid}-deduct-${o.key}`}>Deduct stock on sale</Label>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Recipe change (use a negative quantity for what it replaces, e.g. −200 ml fresh milk)</Label>
              <RecipeEditor label={`Option ${i + 1}`} items={items} lines={o.lines} onChange={(lines) => update(i, { lines })} showCost={showCost} allowNegative disabled={!canEdit} />
            </div>
          </CardContent>
        </Card>
      ))}

      {canEdit && (
        <div className="flex justify-between gap-2">
          <Button type="button" variant="outline" onClick={() => setOptions((os) => [...os, blank()])}><Plus /> Add option</Button>
          <Button type="button" onClick={save}>{pending ? "Saving…" : group ? "Save group" : "Create group"}</Button>
        </div>
      )}
    </fieldset>
  );
}
