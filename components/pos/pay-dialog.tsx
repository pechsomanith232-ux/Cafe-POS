"use client";

import { Printer, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { customersAction } from "@/app/pos/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cashDisplay, settlePayment, type SettleCurrency } from "@/lib/domain/currency";
import { dec } from "@/lib/domain/money";
import { num, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

export type PayMethod = { id: string; name: string; type: string };
type TenderRow = { key: number; methodId: string; currencyCode: string; amount: string };
export type PayResult = { orderId: string; change: { currency: string; amount: string }; warnings: string[] };

const QUICK: Record<string, string[]> = { USD: ["1", "5", "10", "20"], KHR: ["5000", "10000", "20000", "50000"] };
const fmt = (code: string, v: string) => (code === "KHR" ? `${num(v, 0)}៛` : usd(v));

/** Pay dialog (plan §6): split payments, USD/KHR, quick cash, change in a chosen currency. */
export function PayDialog({
  total, methods, currencies, canChargeAccount, onClose, onPay, onNewOrder,
}: {
  total: string; methods: PayMethod[]; currencies: SettleCurrency[]; canChargeAccount: boolean;
  onClose: () => void;
  onPay: (pay: { tenders: { methodId: string; currencyCode: string; amount: string }[]; changeCurrency: string; customerId: string | null }) => Promise<{ ok: true; data: PayResult } | { ok: false; error: string }>;
  onNewOrder: () => void;
}) {
  const usable = methods.filter((m) => m.type !== "account" || canChargeAccount);
  const cashId = usable.find((m) => m.type === "cash")?.id ?? usable[0]?.id ?? "";
  const [methodId, setMethodId] = useState(cashId);
  const [currency, setCurrency] = useState("USD");
  const [amount, setAmount] = useState("");
  const [tenders, setTenders] = useState<TenderRow[]>([]);
  const [changeCurrency, setChangeCurrency] = useState("USD");
  const [customers, setCustomers] = useState<{ id: string; name: string; balance: string; creditLimit: string | null }[] | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [result, setResult] = useState<PayResult | null>(null);
  const [pending, start] = useTransition();
  const cur = (code: string) => currencies.find((c) => c.code === code)!;
  const method = (id: string) => usable.find((m) => m.id === id);
  const isAccount = method(methodId)?.type === "account";
  const anyAccount = tenders.some((t) => method(t.methodId)?.type === "account");

  useEffect(() => { if (anyAccount || isAccount) customersAction().then((r) => (r.ok ? setCustomers(r.data) : toast.error(r.error))); }, [anyAccount, isAccount]);

  const settle = useMemo(() => {
    try {
      return { s: settlePayment(total, tenders.map((t) => ({ cash: method(t.methodId)?.type === "cash", currency: cur(t.currencyCode), amount: t.amount })), cur(changeCurrency)), error: null };
    } catch (e) {
      return { s: null, error: (e as Error).message };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, tenders, changeCurrency]);
  const remaining = settle.s ? settle.s.remainingBase : total;
  const inCur = (base: string, code: string) => (code === "USD" ? dec(base).toFixed(2) : cashDisplay(base, cur(code).rate, cur(code).cashRounding));
  // "Exact": what's left, in the chosen currency, rounded UP to a payable amount.
  const exact = () => {
    const c = cur(currency);
    const raw = dec(remaining).times(c.rate);
    const step = method(methodId)?.type === "cash" ? dec(c.cashRounding) : dec(1).div(dec(10).pow(c.decimals));
    return raw.div(step).ceil().times(step).toFixed(c.decimals);
  };
  const add = (value: string) => {
    if (!/^\d+(\.\d{1,4})?$/.test(value) || Number(value) <= 0) return void toast.error("Enter an amount.");
    setTenders((t) => [...t, { key: Date.now(), methodId, currencyCode: currency, amount: value }]);
    setAmount("");
  };

  const complete = () => start(async () => {
    if (anyAccount && !customerId) return void toast.error("Choose the customer to charge.");
    const r = await onPay({ tenders: tenders.map((t) => ({ methodId: t.methodId, currencyCode: t.currencyCode, amount: t.amount })), changeCurrency, customerId });
    if (!r.ok) return void toast.error(r.error);
    setResult(r.data);
    for (const w of r.data.warnings) toast.warning(w);
  });

  if (result) {
    const print = () => window.open(`/receipt/${result.orderId}?print=1`, "_blank", "noopener");
    return (
      <Dialog open onOpenChange={() => onNewOrder()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Paid</DialogTitle></DialogHeader>
          <div className="py-4 text-center">
            <div className="text-sm text-muted-foreground">Change</div>
            <div className="text-4xl font-semibold tabular-nums" data-testid="change-due">{fmt(result.change.currency, result.change.amount)}</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="h-12" onClick={print}><Printer /> Print receipt</Button>
            <Button className="h-12" onClick={onNewOrder} autoFocus>New order</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[95vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-baseline justify-between gap-4 pr-6">
            <span>Pay</span>
            <span className="tabular-nums">{usd(total)} <span className="text-base font-normal text-muted-foreground">· {fmt("KHR", inCur(total, "KHR"))}</span></span>
          </DialogTitle>
          <DialogDescription>Add one or more payments. Change is given in the currency you pick.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[1fr_15rem]">
          <div className="grid content-start gap-3">
            <div className="flex flex-wrap gap-2">
              {usable.map((m) => (
                <Button key={m.id} type="button" variant={m.id === methodId ? "default" : "outline"} className="h-11" onClick={() => { setMethodId(m.id); if (m.type === "account") setCurrency("USD"); }}>{m.name}</Button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {currencies.map((c) => (
                <Button key={c.code} type="button" variant={currency === c.code ? "secondary" : "outline"} disabled={isAccount && c.code !== "USD"} onClick={() => setCurrency(c.code)}>
                  {c.code === "KHR" ? "Riel ៛" : "USD $"}
                </Button>
              ))}
            </div>
            {method(methodId)?.type === "cash" && (
              <div className="grid grid-cols-4 gap-2">
                {QUICK[currency]?.map((q) => <Button key={q} type="button" variant="outline" className="h-12" onClick={() => add(q)}>{fmt(currency, q)}</Button>)}
              </div>
            )}
            <div className="flex gap-2">
              <Input className="h-12 text-lg" inputMode="decimal" aria-label="Payment amount" placeholder={`Amount (${currency})`} value={amount}
                onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add(amount.trim())} />
              <Button type="button" variant="outline" className="h-12" onClick={() => add(exact())} disabled={dec(remaining).lte(0)}>Exact</Button>
              <Button type="button" className="h-12" onClick={() => add(amount.trim())}>Add</Button>
            </div>
            {(anyAccount || isAccount) && (
              <Select value={customerId ?? ""} onValueChange={setCustomerId}>
                <SelectTrigger className="h-11 w-full" aria-label="Customer to charge"><SelectValue placeholder={customers === null ? "Loading customers…" : "Customer to charge"} /></SelectTrigger>
                <SelectContent>
                  {customers?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} · owes {usd(c.balance)} of {usd(c.creditLimit)}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="grid content-start gap-2 rounded-lg border p-3 text-sm">
            {tenders.length === 0 && <p className="text-muted-foreground">No payments yet.</p>}
            {tenders.map((t) => (
              <div key={t.key} className="flex items-center justify-between gap-2" data-testid="tender">
                <span>{method(t.methodId)?.name}</span>
                <span className="ml-auto tabular-nums">{fmt(t.currencyCode, t.amount)}</span>
                <Button variant="ghost" size="icon" className="size-7" aria-label="Remove payment" onClick={() => setTenders((x) => x.filter((y) => y.key !== t.key))}><Trash2 /></Button>
              </div>
            ))}
            <div className="mt-2 border-t pt-2">
              <div className="flex justify-between"><span>Remaining</span><span className={cn("tabular-nums font-medium", dec(remaining).gt(0) && "text-amber-700")} data-testid="remaining">
                {usd(dec(remaining).gt(0) ? remaining : 0)} · {fmt("KHR", dec(remaining).gt(0) ? inCur(remaining, "KHR") : "0")}
              </span></div>
              {settle.s && dec(settle.s.change.amount).gt(0) && (
                <div className="mt-1 flex items-center justify-between">
                  <span>Change</span>
                  <span className="text-lg font-semibold tabular-nums" data-testid="change-preview">{fmt(settle.s.change.currency, settle.s.change.amount)}</span>
                </div>
              )}
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Change in</span>
                {currencies.map((c) => (
                  <Button key={c.code} type="button" size="sm" className="h-7 px-2" variant={changeCurrency === c.code ? "default" : "outline"} aria-pressed={changeCurrency === c.code} onClick={() => setChangeCurrency(c.code)}>{c.code}</Button>
                ))}
              </div>
              {settle.error && <p className="mt-2 text-xs text-destructive">{settle.error}</p>}
            </div>
            <Button className="mt-2 h-12" disabled={pending || !settle.s?.paid || (tenders.length === 0 && dec(total).gt(0))} onClick={complete}>
              {pending ? "Paying…" : "Complete payment"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
