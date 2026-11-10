"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { createItemAction, updateItemAction } from "@/app/(app)/inventory/actions";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { BASE_UNIT_CODES, ITEM_TYPES, itemInput } from "@/lib/validators/inventory";

type In = z.input<typeof itemInput>;
type Out = z.output<typeof itemInput>;
const NONE = "__none__";
const TYPE_LABELS: Record<string, string> = { ingredient: "Ingredient", resale: "Resale (sold as is)", packaging: "Packaging", other: "Other" };

export function ItemForm({
  item,
  categories,
  baseUnitLocked,
}: {
  item?: { id: string; isActive: boolean } & In;
  categories: { id: string; name: string }[];
  baseUnitLocked?: boolean;
}) {
  const router = useRouter();
  const form = useForm<In, unknown, Out>({
    resolver: zodResolver(itemInput),
    defaultValues: item ?? { name: "", sku: "", categoryId: null, baseUnitCode: "ml", itemType: "ingredient", units: [] },
  });
  const unitsArray = useFieldArray({ control: form.control, name: "units" });
  const base = useWatch({ control: form.control, name: "baseUnitCode" });
  const e = form.formState.errors;

  async function onSubmit(values: Out) {
    if (item) {
      const r = await updateItemAction(item.id, { ...values, isActive: item.isActive });
      if (r.ok) toast.success("Item saved.");
      else toast.error(r.error);
    } else {
      const r = await createItemAction(values);
      if (r.ok) {
        toast.success("Item created. Set opening stock and reorder level below.");
        router.push(`/inventory/items/${r.data.id}`);
      } else toast.error(r.error);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <Card>
        <CardHeader><CardTitle>Item details</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="md:col-span-2"><Field label="Name" error={e.name?.message}><Input {...form.register("name")} placeholder="Fresh Milk" /></Field></div>
            <Field label="SKU (optional)" error={e.sku?.message}><Input {...form.register("sku")} /></Field>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Category">
              <Controller control={form.control} name="categoryId" render={({ field }) => (
                <Select value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? null : v)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No category</SelectItem>
                    {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )} />
            </Field>
            <Field label="Base unit (stock is kept in this unit)" error={baseUnitLocked ? undefined : e.baseUnitCode?.message}>
              <Controller control={form.control} name="baseUnitCode" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={baseUnitLocked}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{BASE_UNIT_CODES.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select>
              )} />
              {baseUnitLocked && <p className="text-xs text-muted-foreground">Fixed: this item already has stock movements.</p>}
            </Field>
            <Field label="Type">
              <Controller control={form.control} name="itemType" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{ITEM_TYPES.map((t) => <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </Field>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Packaging units</div>
                <div className="text-xs text-muted-foreground">e.g. bottle = 1000 {base}, case = 12000 {base}. Used when receiving and counting.</div>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => unitsArray.append({ name: "", factor: "", isPurchaseDefault: false, isCountDefault: false })}>
                <Plus /> Add unit
              </Button>
            </div>
            <div className="grid gap-2">
              {unitsArray.fields.map((f, i) => (
                <div key={f.id} className="grid grid-cols-[1fr_1fr_auto_auto_auto] items-center gap-2">
                  <Input aria-label="Unit name" placeholder="bottle" {...form.register(`units.${i}.name`)} />
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-muted-foreground">=</span>
                    <Input aria-label="Factor" inputMode="decimal" placeholder="1000" {...form.register(`units.${i}.factor`)} />
                    <span className="text-sm text-muted-foreground">{base}</span>
                  </div>
                  <Controller control={form.control} name={`units.${i}.isPurchaseDefault`} render={({ field }) => (
                    <label className="flex items-center gap-1 text-xs"><Checkbox checked={!!field.value} onCheckedChange={(v) => field.onChange(v === true)} />Purchase</label>
                  )} />
                  <Controller control={form.control} name={`units.${i}.isCountDefault`} render={({ field }) => (
                    <label className="flex items-center gap-1 text-xs"><Checkbox checked={!!field.value} onCheckedChange={(v) => field.onChange(v === true)} />Count</label>
                  )} />
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove unit" onClick={() => unitsArray.remove(i)}><Trash2 /></Button>
                </div>
              ))}
              {e.units && <p className="text-xs text-destructive">{e.units.message ?? e.units.root?.message ?? "Check the units: each needs a name and a factor above 0."}</p>}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            {item && <ActiveToggle item={item} values={form.getValues} />}
            <Button type="submit" disabled={form.formState.isSubmitting}>{item ? "Save item" : "Create item"}</Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}

function ActiveToggle({ item, values }: { item: { id: string; isActive: boolean }; values: () => In }) {
  return (
    <label className="mr-auto flex items-center gap-2 text-sm">
      <Switch
        checked={item.isActive}
        onCheckedChange={async (on) => {
          const r = await updateItemAction(item.id, { ...values(), isActive: on });
          if (r.ok) toast.success(on ? "Item activated." : "Item deactivated (history is kept).");
          else toast.error(r.error);
        }}
      />
      Active
    </label>
  );
}
