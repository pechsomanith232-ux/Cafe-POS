"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { cancelCountAction, postCountAction, saveCountLinesAction } from "@/app/(app)/inventory/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dec, type Dec } from "@/lib/domain/money";
import { num, usd } from "@/lib/format";
import type { getCount } from "@/lib/queries/inventory";

type Count = Awaited<ReturnType<typeof getCount>>;
type Entry = { qty: string; unitKey: string };

export function CountSheet({ count }: { count: Count }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [filter, setFilter] = useState("");
  const editable = count.status === "draft";
  const [entries, setEntries] = useState<Record<string, Entry>>(() =>
    Object.fromEntries(
      count.lines.map((l) => {
        const key = l.unitOptions.find((u) => u.label === l.enteredUnitLabel)?.key ?? l.countDefaultKey;
        return [l.itemId, { qty: l.enteredQty === null ? "" : String(Number(l.enteredQty)), unitKey: key }];
      }),
    ),
  );
  const dirty = useMemo(
    () =>
      count.lines.filter((l) => {
        const e = entries[l.itemId];
        const was = l.enteredQty === null ? "" : String(Number(l.enteredQty));
        const wasKey = l.unitOptions.find((u) => u.label === l.enteredUnitLabel)?.key ?? l.countDefaultKey;
        return e.qty !== was || (e.qty !== "" && e.unitKey !== wasKey);
      }),
    [entries, count.lines],
  );

  /** Counted − stock when the count started (preview; posting uses stock at that moment). */
  const diffFor = (l: Count["lines"][number]): Dec | null => {
    const e = entries[l.itemId];
    if (!e || e.qty === "" || !/^\d+(\.\d+)?$/.test(e.qty)) return null;
    const factor = l.unitOptions.find((u) => u.key === e.unitKey)?.factor ?? "1";
    return dec(e.qty).times(factor).minus(l.systemQty);
  };

  const save = async () => {
    if (!dirty.length) return true;
    const r = await saveCountLinesAction(
      count.id,
      dirty.map((l) => ({ itemId: l.itemId, unitKey: entries[l.itemId].unitKey, qty: entries[l.itemId].qty === "" ? null : entries[l.itemId].qty })),
    );
    if (!r.ok) toast.error(r.error);
    return r.ok;
  };

  const shown = count.lines.filter((l) => l.itemName.toLowerCase().includes(filter.toLowerCase()));
  const counted = count.lines.filter((l) => entries[l.itemId]?.qty !== "").length;
  const showCost = count.lines.some((l) => l.avgCost !== null);

  return (
    <div className="grid max-w-5xl gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Find item" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="text-sm text-muted-foreground">{counted} of {count.lines.length} counted · empty rows are left unchanged · posting sets stock to the counted amount, so post right after counting</span>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Stock at start</TableHead>
              <TableHead>Counted</TableHead>
              <TableHead className="text-right">Difference</TableHead>
              {showCost && <TableHead className="text-right">Value</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((l) => {
              const e = entries[l.itemId];
              const diff = diffFor(l);
              return (
                <TableRow key={l.itemId}>
                  <TableCell>{l.itemName}</TableCell>
                  <TableCell className="text-right">{num(l.systemQty)} {l.baseUnit}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Input
                        className="w-28"
                        inputMode="decimal"
                        aria-label={`Counted ${l.itemName}`}
                        disabled={!editable}
                        value={e.qty}
                        onChange={(ev) => setEntries((s) => ({ ...s, [l.itemId]: { ...s[l.itemId], qty: ev.target.value } }))}
                      />
                      <Select disabled={!editable} value={e.unitKey} onValueChange={(v) => setEntries((s) => ({ ...s, [l.itemId]: { ...s[l.itemId], unitKey: v } }))}>
                        <SelectTrigger className="w-28" aria-label="Unit"><SelectValue /></SelectTrigger>
                        <SelectContent>{l.unitOptions.map((u) => <SelectItem key={u.key} value={u.key}>{u.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </TableCell>
                  <TableCell className={`text-right ${diff === null || diff.isZero() ? "" : diff.isNegative() ? "text-destructive" : "text-emerald-600"}`}>
                    {diff === null ? "—" : `${diff.isPositive() && !diff.isZero() ? "+" : ""}${num(diff.toString())} ${l.baseUnit}`}
                  </TableCell>
                  {showCost && <TableCell className="text-right">{diff === null || l.avgCost === null ? "—" : usd(diff.times(l.avgCost).toFixed(2))}</TableCell>}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {editable && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() =>
              confirm("Cancel this count? Nothing will change in stock.") &&
              start(async () => {
                const r = await cancelCountAction(count.id);
                if (r.ok) router.push("/inventory/counts"); else toast.error(r.error);
              })
            }
          >
            Cancel count
          </Button>
          <Button variant="outline" disabled={pending || !dirty.length} onClick={() => start(async () => { if (await save()) toast.success("Saved."); })}>
            Save progress
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              confirm("Post this count? Stock will be corrected for every counted item.") &&
              start(async () => {
                if (!(await save())) return;
                const r = await postCountAction(count.id);
                if (r.ok) { toast.success("Count posted. Stock corrected."); router.refresh(); } else toast.error(r.error);
              })
            }
          >
            Post count
          </Button>
        </div>
      )}
    </div>
  );
}
