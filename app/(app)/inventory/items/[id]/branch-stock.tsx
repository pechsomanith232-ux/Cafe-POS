"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setOpeningStockAction, setReorderLevelAction } from "@/app/(app)/inventory/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dec } from "@/lib/domain/money";
import { breakdown } from "@/lib/domain/units";
import { usd } from "@/lib/format";
import type { ItemDetail } from "@/lib/queries/inventory";

type Level = ItemDetail["levels"][number];

export function BranchStock({ item }: { item: ItemDetail }) {
  const [reorderFor, setReorderFor] = useState<Level | null>(null);
  const [openingFor, setOpeningFor] = useState<Level | null>(null);
  const showCost = item.levels.some((l) => l.avgCost !== null);

  return (
    <Card>
      <CardHeader><CardTitle>Stock by branch</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Branch</TableHead>
              <TableHead>On hand</TableHead>
              {showCost && <TableHead className="text-right">Avg cost</TableHead>}
              {showCost && <TableHead className="text-right">Value</TableHead>}
              <TableHead>Reorder at</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {item.levels.map((l) => (
              <TableRow key={l.branchId}>
                <TableCell>{l.branchCode} · {l.branchName}</TableCell>
                <TableCell className={dec(l.qtyOnHand).isNegative() ? "text-destructive" : undefined}>
                  {breakdown(l.qtyOnHand, item.baseUnit, item.units)}
                </TableCell>
                {showCost && <TableCell className="text-right">{l.avgCost === null ? "—" : `${usd(l.avgCost, 6)} / ${item.baseUnit}`}</TableCell>}
                {showCost && <TableCell className="text-right">{usd(l.stockValue)}</TableCell>}
                <TableCell>{l.reorderLevel === null ? "—" : breakdown(l.reorderLevel, item.baseUnit, item.units)}</TableCell>
                <TableCell className="text-right">
                  {l.canManage && (
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setReorderFor(l)}>Reorder level</Button>
                      {l.movements === 0 && <Button size="sm" onClick={() => setOpeningFor(l)}>Opening stock</Button>}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      {reorderFor && <ReorderDialog item={item} level={reorderFor} onClose={() => setReorderFor(null)} />}
      {openingFor && <OpeningDialog item={item} level={openingFor} onClose={() => setOpeningFor(null)} />}
    </Card>
  );
}

function UnitSelect({ item, value, onChange }: { item: ItemDetail; value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-32" aria-label="Unit"><SelectValue /></SelectTrigger>
      <SelectContent>{item.unitOptions.map((u) => <SelectItem key={u.key} value={u.key}>{u.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function ReorderDialog({ item, level, onClose }: { item: ItemDetail; level: Level; onClose: () => void }) {
  const countDefault = item.units.find((u) => u.isCountDefault) ?? item.units[0];
  const [unitKey, setUnitKey] = useState(countDefault ? `iu:${countDefault.id}` : "base");
  const [qty, setQty] = useState("");
  const [pending, start] = useTransition();
  const save = (value: string | null) =>
    start(async () => {
      const r = await setReorderLevelAction({ branchId: level.branchId, itemId: item.id, unitKey, qty: value });
      if (r.ok) { toast.success("Reorder level saved."); onClose(); } else toast.error(r.error);
    });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Reorder level · {level.branchCode}</DialogTitle>
          <DialogDescription>You&apos;ll see a low-stock alert when stock is at or below this.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input inputMode="decimal" placeholder="e.g. 6" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Reorder level" />
          <UnitSelect item={item} value={unitKey} onChange={setUnitKey} />
        </div>
        <DialogFooter>
          {level.reorderLevel !== null && <Button variant="ghost" disabled={pending} onClick={() => save(null)}>Remove</Button>}
          <Button disabled={pending || !qty} onClick={() => save(qty)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OpeningDialog({ item, level, onClose }: { item: ItemDetail; level: Level; onClose: () => void }) {
  const purchaseDefault = item.units.find((u) => u.isPurchaseDefault) ?? item.units[item.units.length - 1];
  const [unitKey, setUnitKey] = useState(purchaseDefault ? `iu:${purchaseDefault.id}` : "base");
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [pending, start] = useTransition();
  const unitLabel = item.unitOptions.find((u) => u.key === unitKey)?.label ?? item.baseUnit;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Opening stock · {level.branchCode}</DialogTitle>
          <DialogDescription>What you have on the shelf today and what it cost. This can only be set once per branch.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Quantity</Label>
            <div className="flex gap-2">
              <Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Quantity" />
              <UnitSelect item={item} value={unitKey} onChange={setUnitKey} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Cost per {unitLabel} (USD)</Label>
            <Input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} aria-label="Cost" />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={pending || !qty || cost === ""}
            onClick={() =>
              start(async () => {
                const r = await setOpeningStockAction({ branchId: level.branchId, itemId: item.id, unitKey, qty, unitCost: cost });
                if (r.ok) { toast.success("Opening stock recorded."); onClose(); } else toast.error(r.error);
              })
            }
          >
            Save opening stock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
