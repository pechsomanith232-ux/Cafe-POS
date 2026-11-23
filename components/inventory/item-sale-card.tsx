"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setItemSaleAction } from "@/app/[locale]/(app)/inventory/actions";
import { ProductImageCard } from "@/components/menu/product-extras";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useRouter } from "@/i18n/navigation";
import { defaultSaleUnit } from "@/lib/domain/units";

export type ItemSaleSettings = { productId: string; enabled: boolean; price: string; categoryId: string | null; unitKey: string | null; imageUrl: string | null };

const NO_CATEGORY = "none";

/** "Sell on POS" for an inventory item: switch, price, menu category, sold-per unit, photo. */
export function ItemSaleCard({ itemId, sale, categories, unitOptions }: {
  itemId: string;
  sale: ItemSaleSettings | null;
  categories: { id: string; name: string }[];
  unitOptions: { key: string; label: string }[];
}) {
  const t = useTranslations("ItemSale");
  const router = useRouter();
  const [enabled, setEnabled] = useState(sale?.enabled ?? false);
  const [price, setPrice] = useState(sale ? String(Number(sale.price)) : "");
  const [categoryId, setCategoryId] = useState(sale?.categoryId ?? NO_CATEGORY);
  // A saved unit that no longer matches the item comes back as null: the owner must choose again.
  const [unitKey, setUnitKey] = useState(sale ? sale.unitKey ?? "" : defaultSaleUnit(unitOptions));
  const [pending, start] = useTransition();

  const save = () => start(async () => {
    const r = await setItemSaleAction(itemId, { enabled, price: price.trim(), categoryId: categoryId === NO_CATEGORY ? null : categoryId, unitKey });
    if (!r.ok) return void toast.error(r.error);
    toast.success(t("saved"));
    router.refresh();
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <label className="flex items-center gap-3 text-sm font-medium">
          <Switch checked={enabled} onCheckedChange={setEnabled} aria-label={t("enabled")} />
          {t("enabled")}
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("price")}>
            <Input id="item-sale-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label={t("category")}>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="w-full" aria-label={t("category")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CATEGORY}>{t("noCategory")}</SelectItem>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("unit")}>
            <Select value={unitKey} onValueChange={setUnitKey}>
              <SelectTrigger className="w-full" aria-label={t("unit")}><SelectValue placeholder={t("chooseUnit")} /></SelectTrigger>
              <SelectContent>
                {unitOptions.map((u) => <SelectItem key={u.key} value={u.key}>{u.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>
        {sale && !sale.unitKey && !unitKey && <p className="text-sm text-destructive">{t("unitChanged")}</p>}
        <div>
          <Button onClick={save} disabled={pending || !unitKey}>{t("save")}</Button>
        </div>
        {sale && (
          <div className="grid gap-2">
            <p className="text-sm text-muted-foreground">{t("photoHint")}</p>
            <ProductImageCard productId={sale.productId} imageUrl={sale.imageUrl} canEdit />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
