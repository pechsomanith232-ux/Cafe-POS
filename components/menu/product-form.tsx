"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveProductAction } from "@/app/(app)/menu/actions";
import { Field } from "@/components/shared/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { liveRecipeCost, marginPct } from "@/lib/domain/recipe";
import { usd } from "@/lib/format";
import type { MenuCategoryRow, ModifierGroupRow, ProductDetail, RecipeItem } from "@/lib/queries/menu";
import { linesFromRecipe, newLine, RecipeEditor, recipeInput, type RecipeLineState } from "./recipe-editor";

type Deduct = "follow" | "yes" | "no";
type VariantState = { key: string; id?: string; name: string; price: string; sku: string; deduct: Deduct; isDefault: boolean; lines: RecipeLineState[] };

const toDeduct = (v: boolean | null): Deduct => (v === null ? "follow" : v ? "yes" : "no");
const fromDeduct = (d: Deduct) => (d === "follow" ? null : d === "yes");
let seq = 0;
const blankVariant = (isDefault: boolean, name = ""): VariantState => ({ key: `v${++seq}`, name, price: "", sku: "", deduct: "follow", isDefault, lines: [newLine()] });

export function ProductForm({
  product, categories, groups, items, showCost, canEdit,
}: {
  product?: ProductDetail; categories: MenuCategoryRow[]; groups: ModifierGroupRow[]; items: RecipeItem[]; showCost: boolean; canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const uid = useId();
  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "");
  const [station, setStation] = useState(product?.kitchenStation ?? "bar");
  const [deductStock, setDeductStock] = useState(product?.deductStock ?? true);
  const [isActive, setIsActive] = useState(product?.isActive ?? true);
  const [groupIds, setGroupIds] = useState<string[]>(product?.modifierGroupIds ?? []);
  const [variants, setVariants] = useState<VariantState[]>(
    product?.variants.map((v) => ({
      key: v.id, id: v.id, name: v.name, price: String(Number(v.price)), sku: v.sku ?? "", deduct: toDeduct(v.deductStock), isDefault: v.isDefault,
      lines: linesFromRecipe(v.recipe, items),
    })) ?? [blankVariant(true, "Regular")],
  );
  const updateVariant = (i: number, patch: Partial<VariantState>) => setVariants((vs) => vs.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const makeDefault = (i: number) => setVariants((vs) => vs.map((v, j) => ({ ...v, isDefault: j === i })));
  const removeVariant = (i: number) => setVariants((vs) => {
    const next = vs.filter((_, j) => j !== i);
    if (next.length && !next.some((v) => v.isDefault)) next[0] = { ...next[0], isDefault: true };
    return next;
  });

  const save = () =>
    start(async () => {
      const unpriced = variants.find((v) => !v.price.trim());
      if (unpriced) return void toast.error(`Enter a price for ${unpriced.name || "every variant"} (0 for free).`);
      const r = await saveProductAction(product?.id ?? null, {
        name, description, categoryId: categoryId || null, kitchenStation: station as "bar", deductStock, isActive,
        modifierGroupIds: groupIds,
        variants: variants.map((v) => ({ id: v.id, name: v.name, price: v.price.trim(), sku: v.sku, deductStock: fromDeduct(v.deduct), isDefault: v.isDefault, recipe: recipeInput(v.lines) })),
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(product ? "Product saved." : "Product added.");
      if (!product) router.push(`/menu/products/${r.data.id}`);
      router.refresh();
    });

  return (
    <fieldset disabled={!canEdit || pending} className="grid gap-4">
      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Latte" /></Field>
          <Field label="Category">
            <Select value={categoryId || "none"} onValueChange={(v) => setCategoryId(v === "none" ? "" : v)}>
              <SelectTrigger className="w-full" aria-label="Category"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No category</SelectItem>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Kitchen station">
            <Select value={station} onValueChange={setStation}>
              <SelectTrigger className="w-full" aria-label="Kitchen station"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bar">Bar</SelectItem>
                <SelectItem value="kitchen">Kitchen</SelectItem>
                <SelectItem value="none">None (no ticket)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Description"><Textarea rows={1} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <div className="flex items-center gap-3">
            <Switch id={`${uid}-deduct`} checked={deductStock} onCheckedChange={setDeductStock} />
            <Label htmlFor={`${uid}-deduct`}>Deduct stock on sale</Label>
            {!deductStock && <Badge variant="secondary">No stock deduction — the recipe is kept for cost</Badge>}
          </div>
          <div className="flex items-center gap-3">
            <Switch id={`${uid}-active`} checked={isActive} onCheckedChange={setIsActive} />
            <Label htmlFor={`${uid}-active`}>Active (shown on the POS)</Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Modifier groups</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          {groups.length === 0 && <p className="text-sm text-muted-foreground">No modifier groups yet — create them under Menu → Modifier groups.</p>}
          {groups.map((g) => (
            <label key={g.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={groupIds.includes(g.id)} onCheckedChange={(c) => setGroupIds((ids) => (c ? [...ids, g.id] : ids.filter((x) => x !== g.id)))} />
              {g.name} <span className="text-muted-foreground">({g.isRequired ? `choose ${g.minSelect === g.maxSelect ? g.minSelect : `${g.minSelect}–${g.maxSelect}`}` : `up to ${g.maxSelect}`})</span>
            </label>
          ))}
        </CardContent>
      </Card>

      {variants.map((v, i) => {
        const cost = liveRecipeCost(v.lines, items).cost;
        const margin = showCost && v.price ? marginPct(v.price, cost) : null;
        return (
          <Card key={v.key}>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>Variant: {v.name || "(unnamed)"} {v.isDefault && <Badge variant="outline">Default</Badge>}</CardTitle>
              {showCost && <span className="text-sm">Price {usd(v.price || 0)} · Cost {usd(cost, 4)} · Margin <span className="font-medium">{margin === null ? "—" : `${margin}%`}</span></span>}
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <Field label="Name"><Input aria-label={`Variant ${i + 1} name`} value={v.name} onChange={(e) => updateVariant(i, { name: e.target.value })} placeholder="e.g. Large" /></Field>
                <Field label="Price (USD)"><Input aria-label={`Variant ${i + 1} price`} inputMode="decimal" value={v.price} onChange={(e) => updateVariant(i, { price: e.target.value })} /></Field>
                <Field label="SKU"><Input value={v.sku} onChange={(e) => updateVariant(i, { sku: e.target.value })} /></Field>
                <Field label="Deduct stock">
                  <Select value={v.deduct} onValueChange={(d) => updateVariant(i, { deduct: d as Deduct })}>
                    <SelectTrigger className="w-full" aria-label={`Variant ${i + 1} deduct stock`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="follow">Follow product ({deductStock ? "yes" : "no"})</SelectItem>
                      <SelectItem value="yes">Yes</SelectItem>
                      <SelectItem value="no">No</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <div className="flex items-end gap-2 pb-1">
                  <Button type="button" variant={v.isDefault ? "secondary" : "outline"} size="sm" onClick={() => makeDefault(i)} disabled={v.isDefault}>
                    {v.isDefault ? "Default" : "Make default"}
                  </Button>
                  {variants.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove variant ${v.name}`} onClick={() => removeVariant(i)}><Trash2 /></Button>
                  )}
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Recipe (per 1 sold)</Label>
                <RecipeEditor label={`Variant ${i + 1}`} items={items} lines={v.lines} onChange={(lines) => updateVariant(i, { lines })} showCost={showCost} disabled={!canEdit} />
              </div>
            </CardContent>
          </Card>
        );
      })}

      {canEdit && (
        <div className="flex justify-between gap-2">
          <Button type="button" variant="outline" onClick={() => setVariants((vs) => [...vs, blankVariant(vs.length === 0)])}><Plus /> Add variant</Button>
          <Button type="button" onClick={save}>{pending ? "Saving…" : product ? "Save product" : "Create product"}</Button>
        </div>
      )}
    </fieldset>
  );
}
