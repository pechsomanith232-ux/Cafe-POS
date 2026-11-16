"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Field } from "@/components/shared/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { num } from "@/lib/format";
import type { BranchSettings } from "@/lib/branch-settings";
import type { DiningTableRow } from "@/lib/queries/pos";
import { saveBranchPosSettingsAction, saveDiningTableAction, savePaymentMethodAction, setExchangeRateAction } from "./actions";

function TableDialog({ branchId, table, onClose }: { branchId: string; table: DiningTableRow | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(table?.name ?? "");
  const [area, setArea] = useState(table?.area ?? "");
  const [seats, setSeats] = useState(table?.seats ? String(table.seats) : "");
  const [isActive, setIsActive] = useState(table?.isActive ?? true);
  const save = () => start(async () => {
    const r = await saveDiningTableAction(table?.id ?? null, { branchId, name, area, seats: seats ? Number(seats) : null, sortOrder: table?.sortOrder ?? 0, isActive });
    if (!r.ok) return void toast.error(r.error);
    toast.success("Table saved.");
    onClose();
    router.refresh();
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{table ? `Edit ${table.name}` : "New table"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. T1" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Area"><Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Terrace" /></Field>
            <Field label="Seats"><Input inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} /></Field>
          </div>
          {table && <div className="flex items-center gap-3"><Switch id="t-active" checked={isActive} onCheckedChange={setIsActive} /><Label htmlFor="t-active">Active</Label></div>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={pending}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Method = { id: string; name: string; type: string; isActive: boolean };
const TYPES: Record<string, string> = { cash: "Cash", khqr: "KHQR", card: "Card", bank_transfer: "Bank transfer", account: "Charge to account", other: "Other" };

function MethodDialog({ method, onClose }: { method: Method | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(method?.name ?? "");
  const [type, setType] = useState(method?.type ?? "khqr");
  const [isActive, setIsActive] = useState(method?.isActive ?? true);
  const save = () => start(async () => {
    const r = await savePaymentMethodAction(method?.id ?? null, { name, type: type as "cash", isActive });
    if (!r.ok) return void toast.error(r.error);
    toast.success("Payment method saved.");
    onClose();
    router.refresh();
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{method ? `Edit ${method.name}` : "New payment method"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ABA Pay" /></Field>
          <Field label="Type">
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-full" aria-label="Type"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {method && <div className="flex items-center gap-3"><Switch id="m-active" checked={isActive} onCheckedChange={setIsActive} /><Label htmlFor="m-active">Active</Label></div>}
          <p className="text-xs text-muted-foreground">Only Cash counts toward the drawer; only Cash can give change.</p>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={pending}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DrawerRules({ branchId, settings }: { branchId: string; settings: BranchSettings }) {
  const router = useRouter();
  const [threshold, setThreshold] = useState(settings.varianceThreshold);
  const [pin, setPin] = useState(settings.variancePinRequired);
  const [negative, setNegative] = useState(settings.allowNegativeStock);
  const [kitchen, setKitchen] = useState(settings.kitchenEnabled);
  const [pending, start] = useTransition();
  const save = () => start(async () => {
    const r = await saveBranchPosSettingsAction({ branchId, varianceThreshold: threshold, variancePinRequired: pin, allowNegativeStock: negative, kitchenEnabled: kitchen });
    if (!r.ok) return void toast.error(r.error);
    toast.success("Saved.");
    router.refresh();
  });
  return (
    <Card>
      <CardHeader><CardTitle>Cash drawer, stock and kitchen</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex items-center gap-3"><Switch id="v-pin" checked={pin} onCheckedChange={setPin} /><Label htmlFor="v-pin">Closing a shift with a cash difference needs a manager&apos;s PIN</Label></div>
        <Field label="…when the difference is more than (USD)"><Input aria-label="Variance threshold" inputMode="decimal" value={threshold} disabled={!pin} onChange={(e) => setThreshold(e.target.value)} /></Field>
        <p className="text-xs text-muted-foreground">With the PIN off, the shift still closes and the difference is recorded in the Z report and the audit log.</p>
        <div className="flex items-center gap-3"><Switch id="neg" checked={negative} onCheckedChange={setNegative} /><Label htmlFor="neg">Allow selling when stock would go below zero (shows a warning)</Label></div>
        <div className="flex items-center gap-3"><Switch id="kitchen" checked={kitchen} onCheckedChange={setKitchen} /><Label htmlFor="kitchen">Use the kitchen screen (off: orders go straight to payment, nothing is sent to the kitchen)</Label></div>
        <div><Button onClick={save} disabled={pending}>Save rules</Button></div>
      </CardContent>
    </Card>
  );
}

export function PosSettings({ branchId, tables, khrRate, history, methods, settings }: {
  branchId: string; tables: DiningTableRow[]; khrRate: string | null;
  history: { id: string; currencyCode: string; rate: string; effectiveFrom: string; byName: string | null }[]; methods: Method[]; settings: BranchSettings;
}) {
  const [editingMethod, setEditingMethod] = useState<Method | null | "new">(null);
  const router = useRouter();
  const [editing, setEditing] = useState<DiningTableRow | null | "new">(null);
  const [rate, setRate] = useState(khrRate ? String(Number(khrRate)) : "");
  const [pending, start] = useTransition();
  const saveRate = () => start(async () => {
    const r = await setExchangeRateAction({ branchId, currencyCode: "KHR", rate: rate.trim() });
    if (!r.ok) return void toast.error(r.error);
    toast.success("Exchange rate saved. It applies from now on.");
    router.refresh();
  });
  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Exchange rate</CardTitle>
          <CardDescription>Riel per 1 USD, used to show totals in KHR. Current: {khrRate ? `${num(khrRate, 0)}៛` : "not set"}.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-end gap-2">
          <Field label="KHR per USD"><Input aria-label="KHR per USD" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
          <Button onClick={saveRate} disabled={pending || !rate.trim() || Number(rate) === Number(khrRate)}>Save</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Tables</CardTitle>
          <Button size="sm" onClick={() => setEditing("new")}><Plus /> New table</Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Table</TableHead><TableHead>Area</TableHead><TableHead className="text-right">Seats</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {tables.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No tables yet — add them for dine-in orders.</TableCell></TableRow>}
              {tables.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name} {!t.isActive && <Badge variant="outline">Inactive</Badge>}</TableCell>
                  <TableCell>{t.area ?? "—"}</TableCell>
                  <TableCell className="text-right">{t.seats ?? "—"}</TableCell>
                  <TableCell className="text-right"><Button variant="ghost" size="icon" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}><Pencil /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <DrawerRules branchId={branchId} settings={settings} />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div><CardTitle>Payment methods</CardTitle><p className="text-sm text-muted-foreground">For this branch only.</p></div>
          <Button size="sm" onClick={() => setEditingMethod("new")}><Plus /> New method</Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Method</TableHead><TableHead>Type</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {methods.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.name} {!m.isActive && <Badge variant="outline">Inactive</Badge>}</TableCell>
                  <TableCell>{TYPES[m.type] ?? m.type}</TableCell>
                  <TableCell className="text-right"><Button variant="ghost" size="icon" aria-label={`Edit ${m.name}`} onClick={() => setEditingMethod(m)}><Pencil /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Exchange rate history</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>From</TableHead><TableHead>Currency</TableHead><TableHead className="text-right">Rate per $1</TableHead><TableHead>Set by</TableHead></TableRow></TableHeader>
            <TableBody>
              {history.map((h) => (
                <TableRow key={h.id}>
                  <TableCell>{new Date(h.effectiveFrom).toLocaleString("en-GB", { timeZone: "Asia/Phnom_Penh", dateStyle: "short", timeStyle: "short" })}</TableCell>
                  <TableCell>{h.currencyCode}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(h.rate, 2)}</TableCell>
                  <TableCell>{h.byName ?? "Default"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {editing && <TableDialog branchId={branchId} table={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {editingMethod && <MethodDialog method={editingMethod === "new" ? null : editingMethod} onClose={() => setEditingMethod(null)} />}
    </div>
  );
}
