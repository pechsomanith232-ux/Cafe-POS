"use client";

import { ImageIcon, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { comboCostAction, removeProductImageAction, setBranchPriceAction, uploadProductImageAction } from "@/app/(app)/menu/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usd } from "@/lib/format";
import type { ModifierGroupDetail, ProductDetail } from "@/lib/queries/menu";

export function ProductImageCard({ productId, imageUrl, canEdit }: { productId: string; imageUrl: string | null; canEdit: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const upload = (file: File) =>
    start(async () => {
      if (file.size > 2 * 1024 * 1024) return void toast.error("Images must be 2 MB or smaller.");
      const form = new FormData();
      form.set("image", file);
      const r = await uploadProductImageAction(productId, form);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Image saved.");
      router.refresh();
    });
  const remove = () =>
    start(async () => {
      const r = await removeProductImageAction(productId);
      if (!r.ok) return void toast.error(r.error);
      router.refresh();
    });
  return (
    <Card>
      <CardHeader><CardTitle>Image</CardTitle></CardHeader>
      <CardContent className="flex items-center gap-4">
        <div className="flex size-24 items-center justify-center overflow-hidden rounded-md border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element -- served by our own route or the bucket */}
          {imageUrl ? <img src={imageUrl} alt="Product" className="size-full object-cover" /> : <ImageIcon className="size-8 text-muted-foreground" />}
        </div>
        {canEdit && (
          <div className="grid gap-2">
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="Product image file"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => input.current?.click()}><Upload /> {imageUrl ? "Replace" : "Upload"}</Button>
            {imageUrl && <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={remove}><Trash2 /> Remove</Button>}
            <p className="text-xs text-muted-foreground">JPEG, PNG or WebP, up to 2 MB.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BranchPriceRow({ v, branchId, canEdit }: { v: ProductDetail["variants"][number]; branchId: string; canEdit: boolean }) {
  const router = useRouter();
  const [price, setPrice] = useState(v.branchPrice === null ? "" : String(Number(v.branchPrice)));
  const [available, setAvailable] = useState(v.isAvailable);
  const [pending, start] = useTransition();
  const save = (next: { price: string; available: boolean }) =>
    start(async () => {
      const r = await setBranchPriceAction({ branchId, variantId: v.id, price: next.price.trim() === "" ? null : next.price.trim(), isAvailable: next.available });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${v.name} saved for this branch.`);
      router.refresh();
    });
  const dirty = price !== (v.branchPrice === null ? "" : String(Number(v.branchPrice)));
  return (
    <TableRow>
      <TableCell className="font-medium">{v.name}</TableCell>
      <TableCell className="text-right tabular-nums">{usd(v.price)}</TableCell>
      <TableCell>
        <Input className="h-8 w-28" inputMode="decimal" placeholder="Same" value={price} disabled={!canEdit || pending} aria-label={`${v.name} branch price`} onChange={(e) => setPrice(e.target.value)} />
      </TableCell>
      <TableCell>
        <Switch checked={available} disabled={!canEdit || pending} aria-label={`${v.name} available here`} onCheckedChange={(a) => { setAvailable(a); save({ price, available: a }); }} />
      </TableCell>
      <TableCell className="text-right">
        {canEdit && <Button type="button" size="sm" variant="outline" disabled={!dirty || pending} onClick={() => save({ price, available })}>Save</Button>}
      </TableCell>
    </TableRow>
  );
}

export function BranchPricesCard({ product, branchId, branchLabel, canEdit }: { product: ProductDetail; branchId: string; branchLabel: string; canEdit: boolean }) {
  return (
    <Card>
      <CardHeader><CardTitle>Price at {branchLabel}</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Variant</TableHead><TableHead className="text-right">Menu price</TableHead><TableHead>Branch price</TableHead><TableHead>Available</TableHead><TableHead /></TableRow>
          </TableHeader>
          <TableBody>
            {product.variants.map((v) => <BranchPriceRow key={`${v.id}:${v.branchPrice}:${v.isAvailable}`} v={v} branchId={branchId} canEdit={canEdit} />)}
          </TableBody>
        </Table>
        <p className="mt-2 text-xs text-muted-foreground">Leave the branch price empty to use the menu price.</p>
      </CardContent>
    </Card>
  );
}

/** Pick a variant and options to see the sale price, theoretical cost and margin (plan §4.3). */
export function ComboCostCard({ product, groups }: { product: ProductDetail; groups: ModifierGroupDetail[] }) {
  const [variantId, setVariantId] = useState(product.variants.find((v) => v.isDefault)?.id ?? product.variants[0]?.id ?? "");
  const [picked, setPicked] = useState<string[]>([]);
  const [result, setResult] = useState<{ price: string; cost: string | null; margin: string | null; missingCostItems: string[] } | null>(null);
  const [pending, start] = useTransition();
  const calc = (vId: string, mods: string[]) =>
    start(async () => {
      const r = await comboCostAction(vId, mods);
      if (!r.ok) return void toast.error(r.error);
      setResult(r.data);
    });
  const toggle = (id: string, on: boolean) => {
    const next = on ? [...picked, id] : picked.filter((x) => x !== id);
    setPicked(next);
    calc(variantId, next);
  };
  if (!product.variants.length) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Cost of a drink as sold</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        <Select value={variantId} onValueChange={(v) => { setVariantId(v); calc(v, picked); }}>
          <SelectTrigger className="w-60" aria-label="Combination variant"><SelectValue /></SelectTrigger>
          <SelectContent>{product.variants.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
        </Select>
        {groups.map((g) => (
          <div key={g.id} className="flex flex-wrap items-center gap-4 text-sm">
            <span className="w-28 font-medium">{g.name}</span>
            {g.modifiers.map((m) => (
              <label key={m.id} className="flex items-center gap-2">
                <Checkbox checked={picked.includes(m.id)} onCheckedChange={(c) => toggle(m.id, Boolean(c))} />
                {m.name} {Number(m.priceDelta) !== 0 && <span className="text-muted-foreground">{Number(m.priceDelta) > 0 ? "+" : ""}{usd(m.priceDelta)}</span>}
              </label>
            ))}
          </div>
        ))}
        <div className="flex items-center gap-4 text-sm">
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => calc(variantId, picked)}>Calculate</Button>
          {result && (
            <span data-testid="combo-result">
              Price <b>{usd(result.price)}</b> · Cost <b>{usd(result.cost, 4)}</b> · Margin <b>{result.margin === null ? "—" : `${result.margin}%`}</b>
              {result.missingCostItems.length > 0 && <span className="ml-2 text-amber-600">No cost yet: {result.missingCostItems.join(", ")}</span>}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
