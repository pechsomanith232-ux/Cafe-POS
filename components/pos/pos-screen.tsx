"use client";

import { Ban, Banknote, ChefHat, Coffee, History, LayoutDashboard, LogOut, Minus, Pause, Percent, Plus, ReceiptText, Search, Send, ShoppingBasket, Trash2, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { openOrderAction, openOrdersAction, payAction, resumeOrderAction, saveOrderAction } from "@/app/pos/actions";
import { ManagerPinDialog, type PinApproval } from "@/components/shared/manager-pin-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cashDisplay, type SettleCurrency } from "@/lib/domain/currency";
import { computeOrder, type TaxSetting } from "@/lib/domain/pricing";
import { num, usd } from "@/lib/format";
import { cartToInput, useCart, type CartLineState } from "@/lib/pos/cart-store";
import type { OpenOrderRow, PosMenu } from "@/lib/queries/pos";
import { cn } from "@/lib/utils";
import { ProductDialog } from "./product-dialog";
import { CashMovementDialog, CloseShiftDialog, RecentOrdersDialog, RefundDialog, VoidDialog } from "./order-tools";
import { PayDialog, type PayMethod } from "./pay-dialog";
import { RegisterPicker } from "./shift-screens";

type Props = {
  branchId: string; branchName: string; registerId: string; registerName: string; registers: { id: string; name: string }[]; userName: string;
  shift: { id: string; openedAt: string; openedByName: string; cash: { currencyCode: string; openingFloat: string }[] };
  menu: PosMenu; images: Record<string, string>; tables: { id: string; name: string; area: string | null }[];
  khr: { rate: string; rounding: string } | null; tax: TaxSetting;
  /** max % without a PIN; null = no limit; -1 = may not discount without a PIN */
  discountLimit: number | null; reasons: string[]; heldCount: number; canHold: boolean; canCloseShift: boolean; userId: string;
  methods: PayMethod[]; currencies: SettleCurrency[]; canChargeAccount: boolean; canCashMovement: boolean; canQuickPurchase: boolean;
  kitchenEnabled: boolean;
};
type Disc = CartLineState["discount"];

function DiscountDialog({ title, base, current, reasons, limit, onApply, onClose }: {
  title: string; base: string; current: Disc; reasons: string[]; limit: number | null; onApply: (d: Disc) => void; onClose: () => void;
}) {
  const [type, setType] = useState<"percent" | "amount">(current?.type ?? "percent");
  const [value, setValue] = useState(current ? String(Number(current.value)) : "");
  const [reason, setReason] = useState(current?.reason ?? "");
  const quick = type === "percent" ? ["5", "10", "15", "20", "50", "100"] : ["0.25", "0.50", "1", "2"];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>On {usd(base)}.{limit === -1 ? " Any discount needs a manager's PIN." : limit !== null ? ` Above ${limit}% needs a manager's PIN.` : ""}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant={type === "percent" ? "default" : "outline"} onClick={() => setType("percent")}>%</Button>
            <Button type="button" variant={type === "amount" ? "default" : "outline"} onClick={() => setType("amount")}>$ amount</Button>
          </div>
          <Input aria-label="Discount value" inputMode="decimal" className="h-12 text-lg" value={value} onChange={(e) => setValue(e.target.value)} placeholder={type === "percent" ? "e.g. 10" : "e.g. 0.50"} autoFocus />
          <div className="flex flex-wrap gap-2">{quick.map((q) => <Button key={q} type="button" variant="outline" size="sm" onClick={() => setValue(q)}>{type === "percent" ? `${q}%` : usd(q)}</Button>)}</div>
          <Select value={reason || "none"} onValueChange={(r) => setReason(r === "none" ? "" : r)}>
            <SelectTrigger className="w-full" aria-label="Discount reason"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No reason</SelectItem>
              {reasons.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          {current && <Button variant="ghost" className="mr-auto" onClick={() => { onApply(null); onClose(); }}>Remove</Button>}
          <Button onClick={() => {
            const v = value.trim();
            if (!/^\d+(\.\d{1,4})?$/.test(v) || Number(v) <= 0) return void toast.error("Enter a discount greater than 0.");
            if (type === "percent" && Number(v) > 100) return void toast.error("A percent discount can't be more than 100%.");
            const pct = type === "percent" ? Number(v) : Number(base) > 0 ? (Number(v) / Number(base)) * 100 : 0;
            if ((limit === -1 || (limit !== null && pct > limit)) && !reason) return void toast.error("Choose a reason — it's needed for discounts above the limit.");
            onApply({ type, value: v, reason: reason || null }); onClose();
          }}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrdersDialog({ currentId, onClose, onPick }: { currentId: string | null; onClose: () => void; onPick: (o: OpenOrderRow) => void }) {
  const [rows, setRows] = useState<OpenOrderRow[] | null>(null);
  useEffect(() => { openOrdersAction().then((r) => (r.ok ? setRows(r.data.filter((o) => o.id !== currentId)) : toast.error(r.error))); }, [currentId]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Unpaid orders</DialogTitle><DialogDescription>Held bills and orders still open (e.g. sent to the kitchen).</DialogDescription></DialogHeader>
        <div className="grid max-h-[60vh] gap-2 overflow-y-auto">
          {rows === null && <p className="text-sm text-muted-foreground">Loading…</p>}
          {rows?.length === 0 && <p className="text-sm text-muted-foreground">No other unpaid orders.</p>}
          {rows?.map((h) => (
            <button key={h.id} type="button" onClick={() => onPick(h)} className="flex items-center justify-between rounded-md border p-3 text-left hover:bg-accent">
              <span>
                <span className="font-medium">#{h.queueNo} · {h.orderNo} <Badge variant={h.status === "held" ? "secondary" : "outline"}>{h.status === "held" ? "Held" : "Open"}</Badge></span>
                <span className="block text-xs text-muted-foreground">
                  {h.orderType === "dine_in" ? `Dine-in${h.tableName ? ` · ${h.tableName}` : ""}` : "Takeaway"} · {h.itemCount} item{h.itemCount === 1 ? "" : "s"} · {h.createdByName} · {new Date(h.heldAt ?? h.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </span>
              <span className="font-medium tabular-nums">{usd(h.total)}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PosScreen(p: Props) {
  const router = useRouter();
  const cart = useCart();
  const [hydrated, setHydrated] = useState(false);
  const [category, setCategory] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [dialogProduct, setDialogProduct] = useState<PosMenu["products"][number] | null>(null);
  const [discountFor, setDiscountFor] = useState<string | "order" | null>(null);
  const [pinFor, setPinFor] = useState<null | "hold" | "send" | "save">(null);
  const [showHeld, setShowHeld] = useState(false);
  const [closing, setClosing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [recent, setRecent] = useState(false);
  const [refundId, setRefundId] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [cashMove, setCashMove] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [pending, start] = useTransition();
  const search = useRef<HTMLInputElement>(null);
  const saving = useRef(false);

  // Restore the cart, but only if it belongs to this branch and this user.
  useEffect(() => {
    void Promise.resolve(useCart.persist.rehydrate()).then(() => {
      useCart.getState().claim(`${p.branchId}:${p.userId}`);
      setHydrated(true);
    });
  }, [p.branchId, p.userId]);

  const products = useMemo(() => p.menu.products.filter((x) =>
    (category === "all" || x.categoryId === category) && (!query.trim() || x.name.toLowerCase().includes(query.trim().toLowerCase()))), [p.menu.products, category, query]);
  const totals = computeOrder(cart.lines.map((l) => ({ unitPrice: l.unitPrice, qty: l.qty, modifiers: l.modifiers.map((m) => m.priceDelta), discount: l.discount })), cart.orderDiscount, p.tax);
  const khr = (v: string) => (p.khr ? `${num(cashDisplay(v, p.khr.rate, p.khr.rounding), 0)}៛` : "");
  const unsaved = cart.lines.some((l) => !l.id) || cart.lines.length > 0 && !cart.orderId;

  const tap = (prod: PosMenu["products"][number]) => {
    const avail = prod.variants.filter((v) => v.isAvailable);
    if (!avail.length) return void toast.error(`${prod.name} is sold out at this branch.`);
    if (prod.variants.length === 1 && prod.groupIds.length === 0) {
      const v = avail[0];
      cart.add({ variantId: v.id, productId: prod.id, productName: prod.name, variantName: v.name, unitPrice: v.price, qty: 1, modifiers: [], note: "", discount: null });
      return;
    }
    setDialogProduct(prod);
  };

  const save = (then: "hold" | "send" | "save", approval?: PinApproval) => {
    const run = async () => {
      const r = await saveOrderAction({ ...cartToInput(useCart.getState(), p.branchId, p.registerId), then: then === "save" ? null : then, approval: approval ?? null });
      if (!r.ok) {
        if (r.code === "approval_required" && !approval) { setPinFor(then); return r; }
        if (!approval) toast.error(r.error);
        return r;
      }
      if (then === "hold") {
        cart.clear();
        toast.success(`Bill #${r.data.queueNo} held.`);
        router.refresh();
      } else {
        cart.load(r.data);
        toast.success(then === "send" ? `Sent to kitchen — queue #${r.data.queueNo}` : `Saved ${r.data.orderNo}`);
      }
      return r;
    };
    if (approval) return run();
    // One save at a time (double taps, F9 auto-repeat): a second one could create a duplicate order.
    if (saving.current) return Promise.resolve(null);
    saving.current = true;
    start(async () => { try { await run(); } finally { saving.current = false; } });
    return Promise.resolve(null);
  };

  const pick = (o: OpenOrderRow) => {
    if (cart.lines.length) return void toast.error(cart.orderId ? "Hold the current order first." : "Hold or clear the current order first.");
    start(async () => {
      const r = o.status === "held" ? await resumeOrderAction(o.id, p.registerId) : await openOrderAction(o.id);
      if (!r.ok) return void toast.error(r.error);
      cart.load(r.data);
      setShowHeld(false);
      toast.success(`Order #${r.data.queueNo} ${o.status === "held" ? "resumed" : "opened"}.`);
      router.refresh();
    });
  };

  // Desktop shortcuts (plan §6): F2 search, F9 hold.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); search.current?.focus(); }
      const dialogOpen = Boolean(dialogProduct || discountFor || pinFor || showHeld || closing || paying || recent || refundId || voiding || cashMove);
      if (e.key === "F8" && !e.repeat && !dialogOpen && !pending && useCart.getState().lines.length) { e.preventDefault(); setPaying(true); }
      if (e.key === "F9" && !e.repeat && !dialogOpen && !pending && p.canHold && useCart.getState().lines.length) { e.preventDefault(); save("hold"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const discountTarget = discountFor && discountFor !== "order" ? cart.lines.find((l) => l.key === discountFor) : null;
  const lineIndex = discountTarget ? cart.lines.indexOf(discountTarget) : -1;

  return (
    <div className="grid h-screen grid-cols-[minmax(0,1fr)_360px] grid-rows-[3rem_minmax(0,1fr)] bg-muted/30">
      {/* Header */}
      <header className="col-span-2 flex items-center gap-3 border-b bg-background px-3">
        <Coffee className="size-5" />
        <span className="font-semibold">{p.branchName}</span>
        <span className="text-sm text-muted-foreground">{p.registerName} · {p.userName}</span>
        <RegisterPicker registers={p.registers} registerId={p.registerId} />
        <div className="ml-auto flex items-center gap-2">
          {p.khr && <span className="text-xs text-muted-foreground">1 USD = {num(p.khr.rate, 0)}៛</span>}
          {(
            <Button variant="outline" size="sm" onClick={() => setShowHeld(true)}>
              <ReceiptText /> Orders {p.heldCount > 0 && <Badge className="ml-1" data-testid="held-count">{p.heldCount}</Badge>}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" aria-label="POS menu">Menu</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setRecent(true)}><History /> Recent orders &amp; refunds</DropdownMenuItem>
              {p.canCashMovement && <DropdownMenuItem onSelect={() => setCashMove(true)}><Banknote /> Cash in / out</DropdownMenuItem>}
              {p.canQuickPurchase && <DropdownMenuItem asChild><Link href={`/purchasing/receipts/new?type=direct&register=${p.registerId}`}><ShoppingBasket /> Quick purchase</Link></DropdownMenuItem>}
              {p.kitchenEnabled && <DropdownMenuItem asChild><Link href="/kitchen"><ChefHat /> Kitchen screen</Link></DropdownMenuItem>}
              <DropdownMenuItem asChild><Link href="/dashboard"><LayoutDashboard /> Back office</Link></DropdownMenuItem>
              {p.canCloseShift && (<><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => setClosing(true)}><LogOut /> Close shift</DropdownMenuItem></>)}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Products */}
      <section className="flex min-h-0 flex-col gap-2 p-3">
        <div className="flex gap-2">
          <div className="relative w-56 shrink-0">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input ref={search} className="h-10 pl-8" placeholder="Search (F2)" aria-label="Search products" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="flex min-w-0 gap-2 overflow-x-auto pb-1">
            {[{ id: "all", name: "All", color: null }, ...p.menu.categories].map((c) => (
              <Button key={c.id} variant={category === c.id ? "default" : "outline"} className="h-10 shrink-0" onClick={() => setCategory(c.id)}
                style={category !== c.id && c.color ? { borderColor: c.color } : undefined}>{c.name}</Button>
            ))}
          </div>
        </div>
        <div className="grid min-h-0 flex-1 auto-rows-[7.5rem] grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2 overflow-y-auto pr-1">
          {products.map((prod) => {
            const prices = prod.variants.map((v) => Number(v.price));
            const soldOut = prod.variants.every((v) => !v.isAvailable);
            const color = p.menu.categories.find((c) => c.id === prod.categoryId)?.color;
            return (
              <button key={prod.id} type="button" onClick={() => tap(prod)} disabled={soldOut}
                className="relative flex flex-col overflow-hidden rounded-lg border bg-background text-left shadow-xs transition active:scale-[0.98] disabled:opacity-50"
                style={color ? { borderTop: `4px solid ${color}` } : undefined}>
                {p.images[prod.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- served by our own route or the bucket
                  <img src={p.images[prod.id]} alt="" className="h-16 w-full object-cover" />
                ) : <div className="h-4" />}
                <span className="line-clamp-2 px-2 pt-1 text-sm font-medium leading-tight">{prod.name}</span>
                <span className="mt-auto px-2 pb-1.5 text-sm tabular-nums text-muted-foreground">
                  {soldOut ? "Sold out" : Math.min(...prices) === Math.max(...prices) ? usd(prices[0]) : `${usd(Math.min(...prices))}+`}
                </span>
              </button>
            );
          })}
          {products.length === 0 && <p className="col-span-full p-6 text-center text-sm text-muted-foreground">No products{query ? ` matching "${query}"` : ""}.</p>}
        </div>
      </section>

      {/* Cart */}
      <aside className="flex min-h-0 flex-col border-l bg-background">
        <div className="flex items-center gap-2 border-b p-2">
          <div className="grid flex-1 grid-cols-2 gap-1 rounded-md bg-muted p-1">
            {(["takeaway", "dine_in"] as const).map((t) => (
              <button key={t} type="button" onClick={() => cart.setOrderType(t)} className={cn("rounded px-2 py-1.5 text-sm", cart.orderType === t && "bg-background font-medium shadow-xs")}>
                {t === "takeaway" ? "Takeaway" : "Dine-in"}
              </button>
            ))}
          </div>
          {cart.orderType === "dine_in" && (
            <Select value={cart.tableId ?? "none"} onValueChange={(v) => cart.setTable(v === "none" ? null : v)}>
              <SelectTrigger className="h-9 w-28" aria-label="Table"><SelectValue placeholder="Table" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No table</SelectItem>
                {p.tables.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}{t.area ? ` · ${t.area}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex items-center justify-between px-3 pt-2 text-xs text-muted-foreground">
          <span data-testid="order-label">{cart.orderNo ? `#${cart.queueNo} · ${cart.orderNo}` : "New order"}</span>
          {cart.lines.length > 0 && (cart.orderId ? (
            // A saved order is never dropped: "New order" holds it (it stays under Orders).
            p.canHold && <button type="button" className="hover:text-foreground" disabled={pending} onClick={() => save("hold")}>Hold &amp; new order</button>
          ) : (
            <button type="button" className={cn("hover:text-destructive", confirmClear && "font-medium text-destructive")}
              onClick={() => { if (!confirmClear) { setConfirmClear(true); setTimeout(() => setConfirmClear(false), 3000); return; } cart.clear(); setConfirmClear(false); }}>
              {confirmClear ? "Tap again to clear" : "Clear"}
            </button>
          ))}
        </div>
        <ul className="min-h-0 flex-1 divide-y overflow-y-auto px-3" aria-label="Cart">
          {hydrated && cart.lines.length === 0 && <li className="py-10 text-center text-sm text-muted-foreground">Tap a product to start.</li>}
          {hydrated && cart.lines.map((l, i) => {
            const t = totals.lines[i];
            return (
              <li key={l.key} className="py-2" data-testid="cart-line">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium leading-tight">{l.productName}{l.variantName !== l.productName && <span className="font-normal"> · {l.variantName}</span>}</div>
                    {l.modifiers.length > 0 && <div className="text-xs text-muted-foreground">{l.modifiers.map((m) => m.name).join(", ")}</div>}
                    {l.note && <div className="text-xs italic text-muted-foreground">“{l.note}”</div>}
                    {l.discount && <div className="text-xs text-emerald-700">−{l.discount.type === "percent" ? `${Number(l.discount.value)}%` : usd(l.discount.value)} ({usd(t?.lineDiscount)}){l.discount.reason ? ` · ${l.discount.reason}` : ""}</div>}
                    {l.sent && <Badge variant="secondary" className="mt-0.5 text-[10px]">Sent to kitchen</Badge>}
                  </div>
                  <span className="text-sm tabular-nums">{usd(t?.net)}</span>
                </div>
                {!l.sent && (
                  <div className="mt-1 flex items-center gap-1">
                    <Button variant="outline" size="icon" className="size-8" aria-label={`Less ${l.productName}`} onClick={() => (l.qty > 1 ? cart.setQty(l.key, l.qty - 1) : cart.remove(l.key))}><Minus /></Button>
                    <span className="w-7 text-center text-sm tabular-nums">{l.qty}</span>
                    <Button variant="outline" size="icon" className="size-8" aria-label={`More ${l.productName}`} onClick={() => cart.setQty(l.key, l.qty + 1)}><Plus /></Button>
                    <Button variant="ghost" size="sm" className="ml-auto h-8" onClick={() => setDiscountFor(l.key)}><Percent /> Discount</Button>
                    <Button variant="ghost" size="icon" className="size-8" aria-label={`Remove ${l.productName}`} onClick={() => cart.remove(l.key)}><Trash2 /></Button>
                  </div>
                )}
                {l.sent && <div className="mt-0.5 text-xs text-muted-foreground">× {l.qty}</div>}
              </li>
            );
          })}
        </ul>
        <div className="grid gap-1 border-t p-3 text-sm">
          <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{usd(totals.subtotal)}</span></div>
          <div className="flex items-center justify-between">
            <button type="button" className="text-left text-emerald-700 hover:underline disabled:text-muted-foreground" disabled={!cart.lines.length} onClick={() => setDiscountFor("order")}>
              {cart.orderDiscount ? `Order discount ${cart.orderDiscount.type === "percent" ? `${Number(cart.orderDiscount.value)}%` : ""}` : "+ Order discount"}
            </button>
            {Number(totals.orderDiscount) > 0 && <span className="tabular-nums text-emerald-700">−{usd(totals.orderDiscount)}</span>}
          </div>
          {Number(p.tax.rate) > 0 && (
            <div className="flex justify-between text-muted-foreground"><span>Tax {Number(p.tax.rate)}%{p.tax.inclusive ? " (included)" : ""}</span><span className="tabular-nums">{usd(totals.taxTotal)}</span></div>
          )}
          <div className="flex items-baseline justify-between pt-1 text-lg font-semibold">
            <span>Total</span>
            <span className="text-right tabular-nums" data-testid="cart-total">{usd(totals.total)}<span className="block text-sm font-normal text-muted-foreground" data-testid="cart-total-khr">{khr(totals.total)}</span></span>
          </div>
          <div className={`mt-2 grid gap-2 ${p.kitchenEnabled ? "grid-cols-3" : "grid-cols-2"}`}>
            <Button variant="outline" className="h-12" disabled={!cart.lines.length || pending || !p.canHold} onClick={() => save("hold")}><Pause /> Hold</Button>
            {p.kitchenEnabled && <Button variant="outline" className="h-12" disabled={!cart.lines.length || pending} onClick={() => save("send")}><Send /> Kitchen</Button>}
            <Button className="h-12" disabled={!cart.lines.length || pending} onClick={() => setPaying(true)}><Wallet /> Pay</Button>
          </div>
          {unsaved && cart.orderId && <p className="text-xs text-amber-600">Unsaved changes — {p.kitchenEnabled ? "Hold, Kitchen or Pay" : "Hold or Pay"} saves them.</p>}
          {cart.orderId && <button type="button" className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive" onClick={() => setVoiding(true)}><Ban className="size-3" /> Void order</button>}
        </div>
      </aside>

      {dialogProduct && (
        <ProductDialog product={dialogProduct} groups={p.menu.groups} onClose={() => setDialogProduct(null)}
          onAdd={(v) => { cart.add({ ...v, productId: dialogProduct.id, productName: dialogProduct.name, discount: null }); setDialogProduct(null); }} />
      )}
      {discountFor && (
        <DiscountDialog
          title={discountFor === "order" ? "Order discount" : `Discount: ${discountTarget?.productName ?? ""}`}
          base={discountFor === "order" ? totals.subtotal : totals.lines[lineIndex]?.gross ?? "0"}
          current={discountFor === "order" ? cart.orderDiscount : discountTarget?.discount ?? null}
          reasons={p.reasons} limit={p.discountLimit}
          onApply={(d) => (discountFor === "order" ? cart.setOrderDiscount(d) : cart.setLineDiscount(discountFor, d))}
          onClose={() => setDiscountFor(null)}
        />
      )}
      <ManagerPinDialog
        open={pinFor !== null}
        onOpenChange={(o) => !o && setPinFor(null)}
        permission="pos.discount.override"
        title="Approve discount"
        description="This discount is above the cashier's limit."
        onConfirm={async (approval) => (await save(pinFor ?? "save", approval)) ?? { ok: true, data: null }}
      />
      {showHeld && <OrdersDialog currentId={cart.orderId} onClose={() => setShowHeld(false)} onPick={pick} />}
      {closing && <CloseShiftDialog shiftId={p.shift.id} onClose={() => setClosing(false)} />}
      {paying && (
        <PayDialog total={totals.total} methods={p.methods} currencies={p.currencies} canChargeAccount={p.canChargeAccount}
          onClose={() => setPaying(false)}
          onPay={(pay) => payAction(cartToInput(useCart.getState(), p.branchId, p.registerId), { registerId: p.registerId, ...pay })}
          onNewOrder={() => { setPaying(false); cart.clear(); router.refresh(); }} />
      )}
      {recent && <RecentOrdersDialog onClose={() => setRecent(false)} onRefund={(id) => { setRecent(false); setRefundId(id); }} />}
      {refundId && <RefundDialog orderId={refundId} registerId={p.registerId} methods={p.methods} onClose={() => setRefundId(null)} />}
      {voiding && cart.orderId && <VoidDialog orderId={cart.orderId} orderLabel={`#${cart.queueNo}`} onClose={() => setVoiding(false)} onVoided={() => { setVoiding(false); cart.clear(); router.refresh(); }} />}
      {cashMove && <CashMovementDialog branchId={p.branchId} registerId={p.registerId} onClose={() => setCashMove(false)} />}
    </div>
  );
}
