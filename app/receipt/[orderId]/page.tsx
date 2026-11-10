import { notFound } from "next/navigation";
import { AutoPrint } from "@/components/print/auto-print";
import { getContext } from "@/lib/context";
import { cashDisplay } from "@/lib/domain/currency";
import { NotFoundError } from "@/lib/errors";
import { getReceiptData } from "@/lib/queries/pos";

const usd = (v: string | number) => `$${Number(v).toFixed(2)}`;
const khr = (v: string) => `${Number(v).toLocaleString("en-US")}៛`;
const money = (code: string, v: string) => (code === "KHR" ? khr(v) : usd(v));

export default async function ReceiptPage({ params, searchParams }: PageProps<"/receipt/[orderId]">) {
  const ctx = await getContext();
  const { orderId } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) notFound();
  const refundId = typeof sp.refund === "string" ? sp.refund : null;
  const d = await getReceiptData(ctx, orderId, { refundId }).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const o = d.order;
  const k = (v: string) => (d.khrRate ? khr(cashDisplay(v, d.khrRate, "100")) : "");
  const when = o.paidAt ?? o.createdAt;
  return (
    <main className="mx-auto w-[80mm] bg-white p-3 font-mono text-[12px] leading-snug text-black" data-testid="receipt">
      <AutoPrint enabled={sp.print === "1"} />
      {sp.reprint === "1" && <div className="mb-1 border border-black text-center font-bold">REPRINT</div>}
      {d.refund && <div className="mb-1 border border-black text-center font-bold">REFUND</div>}
      <div className="text-center">
        <div className="text-[15px] font-bold">{d.branch.name}</div>
        {d.branch.address && <div>{d.branch.address}</div>}
        {d.branch.phone && <div>{d.branch.phone}</div>}
        {d.branch.header && <div className="whitespace-pre-line">{d.branch.header}</div>}
      </div>
      <div className="my-2 border-t border-dashed border-black" />
      <div className="flex justify-between"><span>Order {o.orderNo}</span></div>
      <div className="flex justify-between"><span className="text-[18px] font-bold">Queue #{o.queueNo}</span><span>{o.orderType === "dine_in" ? `Dine-in${o.tableName ? ` ${o.tableName}` : ""}` : "Takeaway"}</span></div>
      <div className="flex justify-between"><span>{new Date(when).toLocaleString("en-GB", { timeZone: "Asia/Phnom_Penh", dateStyle: "short", timeStyle: "short" })}</span><span>{d.cashierName}</span></div>
      <div className="my-2 border-t border-dashed border-black" />
      {d.refund ? (
        <>
          {d.refund.lines.map((l) => <div key={l.id} className="flex justify-between"><span>{l.qty} × {l.name}{l.restock ? " (restocked)" : ""}</span><span>-{usd(l.amount)}</span></div>)}
          <div className="my-2 border-t border-dashed border-black" />
          <div className="flex justify-between font-bold"><span>Refund</span><span>-{usd(d.refund.totalBase)}</span></div>
          {d.refund.payment && <div className="flex justify-between"><span>{d.refund.payment.method}</span><span>{money(d.refund.payment.p.currencyCode, d.refund.payment.p.amountTendered)}</span></div>}
          <div>Reason: {d.refund.reason}</div>
        </>
      ) : (
        <>
          {o.lines.map((l) => (
            <div key={l.id} className="mb-0.5">
              <div className="flex justify-between gap-2"><span>{l.qty} × {l.productName}{l.variantName !== l.productName ? ` ${l.variantName}` : ""}</span><span>{usd(((Number(l.unitPrice) + Number(l.modifiersTotal)) * l.qty).toFixed(2))}</span></div>
              {l.modifiers.map((m) => <div key={m.modifierId} className="pl-3">+ {m.name}{Number(m.priceDelta) ? ` ${usd(m.priceDelta)}` : ""}</div>)}
              {Number(l.lineDiscountAmount) > 0 && <div className="flex justify-between pl-3"><span>Discount</span><span>-{usd(l.lineDiscountAmount)}</span></div>}
              {l.note && <div className="pl-3 italic">“{l.note}”</div>}
            </div>
          ))}
          <div className="my-2 border-t border-dashed border-black" />
          <div className="flex justify-between"><span>Subtotal</span><span>{usd(o.subtotal)}</span></div>
          {Number(o.orderDiscountAmount) > 0 && <div className="flex justify-between"><span>Discount</span><span>-{usd(o.orderDiscountAmount)}</span></div>}
          {Number(o.taxTotal) > 0 && <div className="flex justify-between"><span>Tax {Number(o.taxRate)}%{o.taxInclusive ? " (incl.)" : ""}</span><span>{usd(o.taxTotal)}</span></div>}
          <div className="flex justify-between text-[15px] font-bold"><span>TOTAL</span><span>{usd(o.total)}</span></div>
          {d.khrRate && <div className="flex justify-between"><span>(1 USD = {Number(d.khrRate).toLocaleString("en-US")}៛)</span><span>{k(o.total)}</span></div>}
          <div className="my-2 border-t border-dashed border-black" />
          {d.payments.map((p) => (
            <div key={p.id}>
              <div className="flex justify-between"><span>{p.method}</span><span>{money(p.currencyCode, p.amountTendered)}</span></div>
              {Number(p.changeAmount) > 0 && <div className="flex justify-between"><span>Change</span><span>{money(p.changeCurrency ?? "USD", p.changeAmount)}</span></div>}
            </div>
          ))}
          {Number(o.refundedTotal) > 0 && <div className="flex justify-between"><span>Refunded</span><span>-{usd(o.refundedTotal)}</span></div>}
          {o.status === "voided" && <div className="text-center font-bold">VOIDED</div>}
        </>
      )}
      <div className="my-2 border-t border-dashed border-black" />
      <div className="whitespace-pre-line text-center">{d.branch.footer ?? "Thank you!"}</div>
    </main>
  );
}
