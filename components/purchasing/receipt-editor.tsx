"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteReceiptAction, saveAndPostReceiptAction, saveReceiptAction } from "@/app/(app)/purchasing/actions";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { dec, sum } from "@/lib/domain/money";
import { usd } from "@/lib/format";
import type { PurchasableItem } from "@/lib/queries/purchasing";

type Line = { itemId: string; unitKey: string; qty: string; unitCost: string };
type Extra = { description: string; amount: string };
export type ReceiptDraft = {
  id: string; supplierId: string | null; supplierNameText: string | null; supplierInvoiceNo: string | null; receiptDate: string;
  paymentTermsDays: number | null; note: string | null; lines: Line[]; extraCosts: Extra[];
};
type Supplier = { id: string; name: string; paymentTermsDays: number };
type Method = { id: string; name: string; type?: string };
const NONE = "__none__";
const isNum = (v: string) => /^\d+(\.\d+)?$/.test(v.trim());

export function ReceiptEditor({
  type, branchId, items, suppliers, methods, today, draft, presetSupplierId, drawers = [], presetRegisterId, branchRate = null,
}: {
  type: "credit" | "direct"; branchId: string; items: PurchasableItem[]; suppliers: Supplier[]; methods: Method[]; today: string;
  draft?: ReceiptDraft; presetSupplierId?: string;
  /** Registers with an open shift, for "paid from the cash drawer" (plan §4.9). */
  drawers?: { registerId: string; name: string }[]; presetRegisterId?: string; branchRate?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const initialSupplier = draft?.supplierId ?? presetSupplierId ?? "";
  const [supplierId, setSupplierId] = useState(initialSupplier);
  const [supplierNameText, setSupplierNameText] = useState(draft?.supplierNameText ?? "");
  const [invoiceNo, setInvoiceNo] = useState(draft?.supplierInvoiceNo ?? "");
  const [date, setDate] = useState(draft?.receiptDate ?? today);
  const [terms, setTerms] = useState(String(draft?.paymentTermsDays ?? suppliers.find((s) => s.id === initialSupplier)?.paymentTermsDays ?? 0));
  const [note, setNote] = useState(draft?.note ?? "");
  const [lines, setLines] = useState<Line[]>(draft?.lines.length ? draft.lines : [{ itemId: "", unitKey: "base", qty: "", unitCost: "" }]);
  const [extras, setExtras] = useState<Extra[]>(draft?.extraCosts ?? []);
  const cash = methods.find((m) => m.name.toLowerCase() === "cash") ?? methods[0];
  const [methodId, setMethodId] = useState(cash?.id ?? "");
  const [currency, setCurrency] = useState("USD");
  const [rate, setRate] = useState("");
  const [reference, setReference] = useState("");
  const [fromDrawer, setFromDrawer] = useState(Boolean(presetRegisterId && drawers.some((d) => d.registerId === presetRegisterId)));
  const [registerId, setRegisterId] = useState(drawers.find((d) => d.registerId === presetRegisterId)?.registerId ?? drawers[0]?.registerId ?? "");
  const isCash = methods.find((m) => m.id === methodId)?.type === "cash";

  const lineTotal = (l: Line) => (isNum(l.qty) && isNum(l.unitCost) ? dec(l.qty).times(l.unitCost) : dec(0));
  const subtotal = sum(lines.map(lineTotal));
  const extraTotal = sum(extras.filter((e) => isNum(e.amount)).map((e) => e.amount));
  const total = subtotal.plus(extraTotal);
  const updateLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const input = () => ({
    branchId, purchaseType: type, supplierId: supplierId || null, supplierNameText: supplierId ? null : supplierNameText || null,
    supplierInvoiceNo: invoiceNo || null, receiptDate: date, paymentTermsDays: type === "credit" ? Number(terms || 0) : null, note: note || null,
    lines: lines.filter((l) => l.itemId), extraCosts: extras.filter((e) => e.description || e.amount),
  });
  const payment = () => ({
    methodId, currencyCode: currency, rate: currency === "USD" || !rate.trim() ? null : rate, reference: reference || null,
    paidFromDrawer: fromDrawer && isCash && registerId ? { registerId } : null,
  });

  const save = (post: boolean) =>
    start(async () => {
      if (post && type === "credit" && !confirm("Post this receipt? Stock and the amount owed update now, and it can't be edited afterwards.")) return;
      const r = post ? await saveAndPostReceiptAction(draft?.id ?? null, input(), type === "direct" ? payment() : null) : await saveReceiptAction(draft?.id ?? null, input());
      if (!r.ok) return void toast.error(r.error);
      toast.success(post ? (type === "direct" ? "Purchase recorded and paid." : "Receipt posted.") : "Draft saved.");
      router.push(`/purchasing/receipts/${r.data.id}`);
      router.refresh();
    });

  return (
    <div className="grid max-w-5xl gap-4">
      <Card>
        <CardContent className="grid gap-3 pt-6 md:grid-cols-4">
          <div className="md:col-span-2">
            <Field label={type === "direct" ? "Supplier (optional)" : "Supplier"}>
              <Select value={supplierId || NONE} onValueChange={(v) => {
                const id = v === NONE ? "" : v;
                setSupplierId(id);
                const s = suppliers.find((x) => x.id === id);
                if (s && type === "credit") setTerms(String(s.paymentTermsDays));
              }}>
                <SelectTrigger className="w-full" aria-label="Supplier"><SelectValue placeholder="Choose supplier…" /></SelectTrigger>
                <SelectContent>
                  {type === "direct" && <SelectItem value={NONE}>No supplier / type a name</SelectItem>}
                  {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          {type === "direct" && !supplierId ? (
            <div className="md:col-span-2"><Field label="Bought from"><Input value={supplierNameText} onChange={(e) => setSupplierNameText(e.target.value)} placeholder="e.g. Central Market" /></Field></div>
          ) : (
            <Field label="Supplier invoice no."><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></Field>
          )}
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          {type === "credit" && <Field label="Payment terms (days)"><Input inputMode="numeric" value={terms} onChange={(e) => setTerms(e.target.value.replace(/\D/g, ""))} /></Field>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Items received</CardTitle></CardHeader>
        <CardContent className="grid gap-2">
          <div className="hidden grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-2 text-xs font-medium text-muted-foreground md:grid">
            <span>Item</span><span>Quantity</span><span>Unit</span><span>Cost per unit (USD)</span><span className="text-right">Line total</span><span />
          </div>
          {lines.map((l, i) => {
            const item = items.find((it) => it.id === l.itemId);
            return (
              <div key={i} className="grid grid-cols-2 items-center gap-2 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
                <Select value={l.itemId} onValueChange={(v) => updateLine(i, { itemId: v, unitKey: items.find((it) => it.id === v)?.purchaseUnitKey ?? "base" })}>
                  <SelectTrigger className="col-span-2 w-full md:col-span-1" aria-label="Item"><SelectValue placeholder="Choose item…" /></SelectTrigger>
                  <SelectContent>{items.map((it) => <SelectItem key={it.id} value={it.id}>{it.name}</SelectItem>)}</SelectContent>
                </Select>
                <Input inputMode="decimal" aria-label="Quantity" value={l.qty} onChange={(e) => updateLine(i, { qty: e.target.value })} />
                <Select value={l.unitKey} onValueChange={(v) => updateLine(i, { unitKey: v })} disabled={!item}>
                  <SelectTrigger className="w-full" aria-label="Unit"><SelectValue /></SelectTrigger>
                  <SelectContent>{(item?.unitOptions ?? [{ key: "base", label: "unit", factor: "1" }]).map((u) => <SelectItem key={u.key} value={u.key}>{u.label}</SelectItem>)}</SelectContent>
                </Select>
                <Input inputMode="decimal" aria-label="Cost per unit" value={l.unitCost} onChange={(e) => updateLine(i, { unitCost: e.target.value })} />
                <span className="text-right text-sm">{usd(lineTotal(l).toFixed(2))}</span>
                <Button variant="ghost" size="icon" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>
            );
          })}
          <Button variant="outline" className="w-fit" onClick={() => setLines((ls) => [...ls, { itemId: "", unitKey: "base", qty: "", unitCost: "" }])}><Plus /> Add item</Button>

          <div className="mt-4 grid gap-2">
            <div className="text-sm font-medium">Extra costs <span className="font-normal text-muted-foreground">(delivery etc. — spread over the items by value)</span></div>
            {extras.map((e, i) => (
              <div key={i} className="flex gap-2">
                <Input placeholder="Delivery" aria-label="Extra cost description" value={e.description} onChange={(ev) => setExtras((x) => x.map((y, j) => (j === i ? { ...y, description: ev.target.value } : y)))} />
                <Input className="w-32" inputMode="decimal" aria-label="Extra cost amount" value={e.amount} onChange={(ev) => setExtras((x) => x.map((y, j) => (j === i ? { ...y, amount: ev.target.value } : y)))} />
                <Button variant="ghost" size="icon" aria-label="Remove extra cost" onClick={() => setExtras((x) => x.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>
            ))}
            <Button variant="ghost" className="w-fit" onClick={() => setExtras((x) => [...x, { description: "", amount: "" }])}><Plus /> Add extra cost</Button>
          </div>

          <div className="mt-2 grid justify-end gap-1 text-right text-sm">
            <div>Items: {usd(subtotal.toFixed(2))}</div>
            {extraTotal.gt(0) && <div>Extra costs: {usd(extraTotal.toFixed(2))}</div>}
            <div className="text-lg font-semibold">Total: {usd(total.toFixed(2))}</div>
            {type === "direct" && currency !== "USD" && isNum(rate) && <div className="text-muted-foreground">= {dec(total).times(rate).toDecimalPlaces(0).toNumber().toLocaleString()} {currency}</div>}
          </div>
          <Field label="Note"><Textarea rows={1} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </CardContent>
      </Card>

      {type === "direct" && (
        <Card>
          <CardHeader><CardTitle>Paid now</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <Field label="Payment method">
              <Select value={methodId} onValueChange={setMethodId}>
                <SelectTrigger className="w-full" aria-label="Payment method"><SelectValue /></SelectTrigger>
                <SelectContent>{methods.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Currency">
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger className="w-full" aria-label="Currency"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="KHR">KHR (riel)</SelectItem></SelectContent>
              </Select>
            </Field>
            {currency !== "USD" && <Field label="Rate (riel per $1)"><Input inputMode="decimal" placeholder={branchRate ? `${Number(branchRate)} (branch rate)` : "4100"} value={rate} onChange={(e) => setRate(e.target.value)} /></Field>}
            <Field label="Reference (optional)"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
            <div className="flex flex-wrap items-center gap-3 text-sm md:col-span-4">
              <label className="flex items-center gap-2">
                <Checkbox checked={fromDrawer && isCash} disabled={!isCash || drawers.length === 0} onCheckedChange={(c) => setFromDrawer(Boolean(c))} aria-label="Paid from the cash drawer" />
                Paid from the cash drawer
              </label>
              {drawers.length > 1 && fromDrawer && isCash && (
                <Select value={registerId} onValueChange={setRegisterId}>
                  <SelectTrigger className="h-8 w-40" aria-label="Drawer"><SelectValue /></SelectTrigger>
                  <SelectContent>{drawers.map((d) => <SelectItem key={d.registerId} value={d.registerId}>{d.name}</SelectItem>)}</SelectContent>
                </Select>
              )}
              <span className="text-xs text-muted-foreground">{drawers.length === 0 ? "No open shift at this branch — the drawer can't be used." : !isCash ? "Only cash comes from the drawer." : "Records a pay-out on the open shift so the cash count stays right."}</span>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {draft && (
          <Button variant="ghost" disabled={pending} onClick={() => confirm("Delete this draft?") && start(async () => {
            const r = await deleteReceiptAction(draft.id);
            if (r.ok) { toast.success("Draft deleted."); router.push("/purchasing/receipts"); } else toast.error(r.error);
          })}>Delete draft</Button>
        )}
        <Button variant="outline" disabled={pending} onClick={() => save(false)}>Save draft</Button>
        <Button disabled={pending} onClick={() => save(true)}>{type === "direct" ? "Post & Pay" : "Post receipt"}</Button>
      </div>
    </div>
  );
}
