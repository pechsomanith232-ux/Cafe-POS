import { notFound } from "next/navigation";
import { AutoPrint } from "@/components/print/auto-print";
import { getContext } from "@/lib/context";
import { NotFoundError } from "@/lib/errors";
import { getShiftReport } from "@/lib/queries/pos";

const usd = (v: string | number) => `$${Number(v).toFixed(2)}`;
const money = (code: string, v: string | null) => (v === null ? "—" : code === "KHR" ? `${Number(v).toLocaleString("en-US")}៛` : usd(v));
const time = (d: Date | null) => (d ? new Date(d).toLocaleString("en-GB", { timeZone: "Asia/Phnom_Penh", dateStyle: "short", timeStyle: "short" }) : "—");

function Row({ l, v }: { l: string; v: string }) {
  return <div className="flex justify-between gap-2"><span>{l}</span><span>{v}</span></div>;
}

/** X report while the shift is open, Z report once closed (plan §4.8). 80 mm print layout. */
export default async function ShiftReportPage({ params, searchParams }: PageProps<"/pos/shift/[id]/report">) {
  const ctx = await getContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const r = await getShiftReport(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const closed = r.shift.status === "closed";
  return (
    <main className="mx-auto w-[80mm] bg-white p-3 font-mono text-[12px] leading-snug text-black" data-testid="shift-report">
      <style>{`@page { size: 80mm auto; margin: 0 }`}</style>
      <AutoPrint enabled={(await searchParams).print === "1"} />
      <div className="text-center text-[15px] font-bold">{closed ? "Z REPORT" : "X REPORT"}</div>
      <div className="text-center">{r.shift.register}</div>
      <div className="my-2 border-t border-dashed border-black" />
      <Row l="Opened" v={`${time(r.shift.openedAt)} ${r.shift.openedByName}`} />
      <Row l="Closed" v={closed ? time(r.shift.closedAt) : "still open"} />
      <div className="my-2 border-t border-dashed border-black" />
      <Row l="Orders" v={String(r.orderCount)} />
      <Row l="Sales" v={usd(r.salesTotal)} />
      <Row l="Discounts" v={usd(r.discountTotal)} />
      <Row l="Tax" v={usd(r.taxTotal)} />
      <Row l={`Refunds (${r.refundCount})`} v={`-${usd(r.refundTotal)}`} />
      <Row l="Voided orders" v={String(r.voidCount)} />
      <div className="my-2 border-t border-dashed border-black" />
      <div className="font-bold">Payments</div>
      {r.byMethod.map((m) => <Row key={m.method + m.currencyCode} l={`${m.method} ${m.currencyCode}`} v={money(m.currencyCode, m.amount)} />)}
      {r.changeGiven.map((c) => <Row key={"c" + c.currencyCode} l={`Change given ${c.currencyCode}`} v={`-${money(c.currencyCode, c.amount)}`} />)}
      {r.refundsByMethod.map((m) => <Row key={"r" + m.method + m.currencyCode} l={`Refund ${m.method} ${m.currencyCode}`} v={`-${money(m.currencyCode, m.amount)}`} />)}
      {r.customerCash.map((c) => <Row key={"ar" + c.currencyCode} l={`Customer payments cash ${c.currencyCode}`} v={money(c.currencyCode, c.amount)} />)}
      {r.cashMovements.length > 0 && (
        <>
          <div className="my-2 border-t border-dashed border-black" />
          <div className="font-bold">Cash in / out</div>
          {r.cashMovements.map((m) => <Row key={m.id} l={`${m.type === "pay_in" ? "In" : "Out"}: ${m.reason}`} v={`${m.type === "pay_in" ? "" : "-"}${money(m.currencyCode, m.amount)}`} />)}
        </>
      )}
      <div className="my-2 border-t border-dashed border-black" />
      <div className="font-bold">Cash drawer</div>
      {r.cash.map((c) => (
        <div key={c.currencyCode} className="mb-1">
          <Row l={`${c.currencyCode} float`} v={money(c.currencyCode, c.openingFloat)} />
          <Row l={`${c.currencyCode} expected`} v={money(c.currencyCode, c.expected)} />
          {closed && <Row l={`${c.currencyCode} counted`} v={money(c.currencyCode, c.counted)} />}
          {closed && <Row l={`${c.currencyCode} difference`} v={money(c.currencyCode, c.variance)} />}
        </div>
      ))}
    </main>
  );
}
