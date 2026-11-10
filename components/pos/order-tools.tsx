"use client";

import { Minus, Plus, Printer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { cashMovementAction, closeShiftAction, recentOrdersAction, refundableAction, refundOrderAction, shiftReportAction, voidOrderAction } from "@/app/pos/actions";
import { Field } from "@/components/shared/field";
import { ManagerPinDialog, type PinApproval } from "@/components/shared/manager-pin-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dec } from "@/lib/domain/money";
import { num, usd } from "@/lib/format";
import type { RecentOrderRow, RefundableOrder, ShiftReport } from "@/lib/queries/pos";
import type { PayMethod } from "./pay-dialog";

const STATUS: Record<string, string> = { paid: "Paid", partially_refunded: "Part refunded", refunded: "Refunded", voided: "Voided" };
const money = (code: string, v: string | null) => (code === "KHR" ? `${num(v, 0)}៛` : usd(v));

/** Recent paid / refunded / voided orders: reprint or refund. */
export function RecentOrdersDialog({ onClose, onRefund }: { onClose: () => void; onRefund: (id: string) => void }) {
  const [rows, setRows] = useState<RecentOrderRow[] | null>(null);
  useEffect(() => { recentOrdersAction().then((r) => (r.ok ? setRows(r.data) : toast.error(r.error))); }, []);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>Recent orders</DialogTitle><DialogDescription>Reprint a receipt or refund a paid order.</DialogDescription></DialogHeader>
        <div className="grid max-h-[60vh] gap-2 overflow-y-auto">
          {rows === null && <p className="text-sm text-muted-foreground">Loading…</p>}
          {rows?.length === 0 && <p className="text-sm text-muted-foreground">No paid orders yet.</p>}
          {rows?.map((o) => (
            <div key={o.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">#{o.queueNo} · {o.orderNo} <Badge variant="outline">{STATUS[o.status]}</Badge></div>
                <div className="text-xs text-muted-foreground">{(o.paidAt ?? o.voidedAt) ? new Date((o.paidAt ?? o.voidedAt)!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""} · {o.createdByName}{Number(o.refundedTotal) > 0 ? ` · refunded ${usd(o.refundedTotal)}` : ""}</div>
              </div>
              <span className="tabular-nums">{usd(o.total)}</span>
              {o.status !== "voided" && <Button size="sm" variant="ghost" aria-label={`Reprint ${o.orderNo}`} onClick={() => window.open(`/receipt/${o.id}?print=1&reprint=1`, "_blank", "noopener")}><Printer /></Button>}
              {(o.status === "paid" || o.status === "partially_refunded") && <Button size="sm" variant="outline" onClick={() => onRefund(o.id)}>Refund</Button>}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Refund lines (plan §4.7): qty per line, restock per line, method/currency, reason, manager PIN. */
export function RefundDialog({ orderId, registerId, methods, onClose }: { orderId: string; registerId: string; methods: PayMethod[]; onClose: () => void }) {
  const router = useRouter();
  const [order, setOrder] = useState<RefundableOrder | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [methodId, setMethodId] = useState(methods.find((m) => m.type === "cash")?.id ?? methods[0]?.id ?? "");
  const [currency, setCurrency] = useState("USD");
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState(false);
  useEffect(() => {
    refundableAction(orderId).then((r) => {
      if (!r.ok) return void toast.error(r.error);
      setOrder(r.data);
      setRestock(Object.fromEntries(r.data.lines.map((l) => [l.id, l.defaultRestock])));
      // A charged order is refunded back to the account by default, so the customer doesn't get cash and still owe.
      const acct = methods.find((m) => m.type === "account");
      if (acct && Number(r.data.accountDue) > 0) setMethodId(acct.id);
    });
  }, [orderId, methods]);
  const picked = order?.lines.filter((l) => (qty[l.id] ?? 0) > 0) ?? [];
  const estimate = picked.reduce((a, l) => a.plus(dec(l.lineTotal).times(qty[l.id]).div(l.qty)), dec(0));
  const submit = async (approval: PinApproval) => {
    const r = await refundOrderAction(orderId, {
      registerId, reason, approval, method: { methodId, currencyCode: currency },
      lines: picked.map((l) => ({ orderLineId: l.id, qty: qty[l.id], restock: restock[l.id] ?? false })),
    });
    if (r.ok) {
      toast.success(`Refunded ${money(r.data.paidOut.currency, r.data.paidOut.amount)}.`);
      window.open(`/receipt/${orderId}?print=1&refund=${r.data.refundId}`, "_blank", "noopener");
      onClose();
      router.refresh();
    }
    return r;
  };
  return (
    <>
      <Dialog open={!pin} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>Refund {order ? `#${order.queueNo} · ${order.orderNo}` : ""}</DialogTitle><DialogDescription>Choose quantities. Resale items go back into stock by default; prepared drinks don&apos;t.</DialogDescription></DialogHeader>
          {!order ? <p className="text-sm text-muted-foreground">Loading…</p> : (
            <div className="grid gap-3">
              <div className="grid max-h-[40vh] gap-2 overflow-y-auto">
                {order.lines.map((l) => (
                  <div key={l.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{l.productName}{l.variantName !== l.productName && ` · ${l.variantName}`}</div>
                      <div className="text-xs text-muted-foreground">{l.qty} sold · {l.remainingQty} refundable · {usd(l.lineTotal)}</div>
                    </div>
                    <Button variant="outline" size="icon" className="size-8" aria-label={`Fewer ${l.productName}`} disabled={!qty[l.id]} onClick={() => setQty({ ...qty, [l.id]: (qty[l.id] ?? 0) - 1 })}><Minus /></Button>
                    <span className="w-6 text-center tabular-nums">{qty[l.id] ?? 0}</span>
                    <Button variant="outline" size="icon" className="size-8" aria-label={`More ${l.productName}`} disabled={(qty[l.id] ?? 0) >= l.remainingQty} onClick={() => setQty({ ...qty, [l.id]: (qty[l.id] ?? 0) + 1 })}><Plus /></Button>
                    <label className="flex items-center gap-1 text-xs"><Checkbox checked={restock[l.id] ?? false} disabled={!l.deductStock} onCheckedChange={(c) => setRestock({ ...restock, [l.id]: Boolean(c) })} aria-label={`Restock ${l.productName}`} /> Restock</label>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Select value={methodId} onValueChange={setMethodId}>
                  <SelectTrigger className="w-full" aria-label="Refund method"><SelectValue /></SelectTrigger>
                  <SelectContent>{methods.filter((m) => m.type !== "account" || Number(order.accountDue) > 0).map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger className="w-full" aria-label="Refund currency"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="KHR">Riel</SelectItem></SelectContent>
                </Select>
              </div>
              <Input aria-label="Refund reason" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          )}
          <DialogFooter className="items-center">
            <span className="mr-auto text-sm">About {usd(estimate.toFixed(2))}</span>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={!picked.length || !reason.trim()} onClick={() => setPin(true)}>Refund…</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ManagerPinDialog open={pin} onOpenChange={(o) => { if (!o) setPin(false); }} permission="pos.refund" title="Approve refund" description={`${reason} · about ${usd(estimate.toFixed(2))}`} onConfirm={submit} />
    </>
  );
}

/** Void an unpaid order: reason + manager PIN (plan §4.7). */
export function VoidDialog({ orderId, orderLabel, onClose, onVoided }: { orderId: string; orderLabel: string; onClose: () => void; onVoided: () => void }) {
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState(false);
  return (
    <>
      <Dialog open={!pin} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Void {orderLabel}</DialogTitle><DialogDescription>Cancels the order. Nothing was paid, so stock isn&apos;t touched.</DialogDescription></DialogHeader>
          <Input aria-label="Void reason" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="destructive" disabled={!reason.trim()} onClick={() => setPin(true)}>Void…</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <ManagerPinDialog open={pin} onOpenChange={(o) => { if (!o) setPin(false); }} permission="pos.void" title="Approve void" description={reason}
        onConfirm={async (approval) => { const r = await voidOrderAction(orderId, { reason, approval }); if (r.ok) { toast.success("Order voided."); onVoided(); } return r; }} />
    </>
  );
}

/** Cash pay-in / pay-out with a reason (plan §4.8). */
export function CashMovementDialog({ branchId, registerId, onClose }: { branchId: string; registerId: string; onClose: () => void }) {
  const [type, setType] = useState<"pay_out" | "pay_in">("pay_out");
  const [currency, setCurrency] = useState("USD");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const save = () => start(async () => {
    const r = await cashMovementAction({ branchId, registerId, type, currencyCode: currency, amount: amount.trim(), reason });
    if (!r.ok) return void toast.error(r.error);
    toast.success(type === "pay_out" ? "Pay-out recorded." : "Pay-in recorded.");
    onClose();
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Cash in / out</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <Button variant={type === "pay_out" ? "default" : "outline"} onClick={() => setType("pay_out")}>Pay out</Button>
            <Button variant={type === "pay_in" ? "default" : "outline"} onClick={() => setType("pay_in")}>Pay in</Button>
          </div>
          <div className="grid grid-cols-[6rem_1fr] gap-2">
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger aria-label="Cash currency"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="KHR">Riel</SelectItem></SelectContent>
            </Select>
            <Input aria-label="Cash amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" />
          </div>
          <Input aria-label="Cash reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (e.g. ice, change top-up)" />
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={pending || !amount.trim() || !reason.trim()}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Close shift: expected vs counted per currency; a variance over the threshold asks for a manager PIN (unless switched off). */
export function CloseShiftDialog({ shiftId, onClose }: { shiftId: string; onClose: () => void }) {
  const router = useRouter();
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [pin, setPin] = useState<string | null>(null);
  const [done, setDone] = useState<{ cash: { currencyCode: string; expected: string; counted: string; variance: string }[]; varianceBase: string } | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => { shiftReportAction(shiftId).then((r) => (r.ok ? setReport(r.data) : toast.error(r.error))); }, [shiftId]);
  const input = (approval?: PinApproval) => ({ counted: (report?.cash ?? []).map((c) => ({ currencyCode: c.currencyCode, amount: counted[c.currencyCode]?.trim() || "0" })), notes: notes.trim() || null, approval: approval ?? null });
  const close = () => start(async () => {
    const r = await closeShiftAction(shiftId, input());
    if (r.ok) return void setDone(r.data);
    if (r.code === "approval_required") return void setPin(r.error);
    toast.error(r.error);
  });
  const finish = () => { onClose(); router.refresh(); };
  return (
    <>
      <Dialog open={!pin} onOpenChange={(o) => { if (o) return; if (done) finish(); else onClose(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{done ? "Shift closed" : "Close shift"}</DialogTitle>
            <DialogDescription>{done ? "Expected vs counted cash per currency." : "Count the cash in the drawer. Held bills move to the next shift."}</DialogDescription>
          </DialogHeader>
          {done ? (
            <div className="grid gap-1 text-sm" data-testid="close-summary">
              {done.cash.map((c) => (
                <div key={c.currencyCode} className="flex justify-between">
                  <span>{c.currencyCode}</span>
                  <span className="tabular-nums">expected {money(c.currencyCode, c.expected)} · counted {money(c.currencyCode, c.counted)} · <b>{Number(c.variance) > 0 ? "+" : ""}{money(c.currencyCode, c.variance)}</b></span>
                </div>
              ))}
            </div>
          ) : !report ? <p className="text-sm text-muted-foreground">Loading…</p> : (
            <div className="grid gap-3">
              {report.cash.map((c) => {
                const v = counted[c.currencyCode] ? dec(counted[c.currencyCode] || 0).minus(c.expected) : null;
                return (
                  <Field key={c.currencyCode} label={`Counted ${c.currencyCode} (expected ${money(c.currencyCode, c.expected)})`}>
                    <div className="flex items-center gap-2">
                      <Input aria-label={`Counted ${c.currencyCode}`} inputMode="decimal" value={counted[c.currencyCode] ?? ""} onChange={(e) => setCounted({ ...counted, [c.currencyCode]: e.target.value })} />
                      {v && !v.isZero() && <span className={v.isNegative() ? "text-destructive" : "text-emerald-700"}>{v.isPositive() ? "+" : ""}{money(c.currencyCode, v.toString())}</span>}
                    </div>
                  </Field>
                );
              })}
              <Field label="Reason for any difference"><Input aria-label="Reason for difference" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Needed when the cash is off by more than the limit" /></Field>
            </div>
          )}
          <DialogFooter>
            {done ? (
              <>
                <Button variant="outline" onClick={() => window.open(`/pos/shift/${shiftId}/report?print=1`, "_blank", "noopener")}><Printer /> Z report</Button>
                <Button onClick={finish}>Done</Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => window.open(`/pos/shift/${shiftId}/report?print=1`, "_blank", "noopener")}><Printer /> X report</Button>
                <Button onClick={close} disabled={pending || !report}>{pending ? "Closing…" : "Close shift"}</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ManagerPinDialog open={pin !== null} onOpenChange={(o) => { if (!o) setPin(null); }} permission="shift.close_variance_override" title="Approve cash difference" description={pin ?? undefined}
        onConfirm={async (approval) => { const r = await closeShiftAction(shiftId, input(approval)); if (r.ok) { setPin(null); setDone(r.data); } return r; }} />
    </>
  );
}
