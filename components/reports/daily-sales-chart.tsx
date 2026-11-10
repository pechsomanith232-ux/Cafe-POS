"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { usd } from "@/lib/format";

type Point = { date: string; netSales: string; orders: number };

/** Clean axis ticks (1/2/5 × 10ⁿ) spanning [min, max], always including 0. */
function ticks(min: number, max: number, target = 4) {
  const lo = Math.min(0, min), hi = Math.max(0, max, 1);
  const raw = (hi - lo) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const start = Math.floor(lo / step) * step, end = Math.ceil(hi / step) * step;
  const out: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}
const tickLabel = (v: number) => (Math.abs(v) >= 10000 ? `$${Math.round(v / 1000)}K` : `$${v.toLocaleString("en-US")}`);
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/**
 * Daily net sales as columns (single series, so no legend: the title names it).
 * Thin bars with a 4px rounded data end, square at the zero baseline; each bar
 * is its own hover/focus target with a tooltip; a table view mirrors the data.
 */
export function DailySalesChart({ data, title }: { data: Point[]; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const titleId = useId();
  const W = 640, H = 220, L = 52, R = 8, T = 12, B = 26;
  const vals = data.map((d) => Number(d.netSales));
  const tk = ticks(Math.min(...vals, 0), Math.max(...vals, 0));
  const y0 = tk[0], y1 = tk[tk.length - 1];
  const y = (v: number) => T + (H - T - B) * (1 - (v - y0) / (y1 - y0 || 1));
  const band = (W - L - R) / Math.max(data.length, 1);
  const bw = Math.min(24, Math.max(2, band - 4));
  const r = Math.min(4, bw / 2);
  const every = Math.ceil(data.length / 8);

  const bar = (i: number, v: number) => {
    const x = L + band * i + (band - bw) / 2, base = y(0), top = y(v);
    const h = Math.abs(base - top);
    if (h < 0.5) return "";
    const rr = Math.min(r, h);
    // Rounded at the data end (top for positive, bottom for negative), square at the baseline.
    return v >= 0
      ? `M${x},${base}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + bw - rr}Q${x + bw},${top} ${x + bw},${top + rr}V${base}Z`
      : `M${x},${base}V${top - rr}Q${x},${top} ${x + rr},${top}H${x + bw - rr}Q${x + bw},${top} ${x + bw},${top - rr}V${base}Z`;
  };
  const h = hover !== null ? data[hover] : null;

  return (
    <figure className="grid gap-2">
      <figcaption id={titleId} className="text-sm font-medium">{title}</figcaption>
      <p id={`${titleId}-sum`} className="sr-only">
        Total {usd(vals.reduce((a, v) => a + v, 0))}; highest {usd(Math.max(...vals, 0))}; lowest {usd(Math.min(...vals, 0))}. Use “Show as table” for every day.
      </p>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="group" aria-labelledby={titleId} aria-describedby={`${titleId}-sum`} onPointerLeave={() => setHover(null)}>
          {tk.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth={1} />
              <text x={L - 6} y={y(v)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--viz-muted)">{tickLabel(v)}</text>
            </g>
          ))}
          {data.map((d, i) => (
            <g key={d.date}>
              <path d={bar(i, vals[i])} fill="var(--viz-series-1)" opacity={hover === null || hover === i ? 1 : 0.55} />
              {/* Hit target: the whole band, taller than the bar. */}
              <rect role="img" x={L + band * i} y={T} width={band} height={H - T - B} fill="transparent" tabIndex={0}
                aria-label={`${d.date}: ${usd(d.netSales)}, ${d.orders} orders`}
                onPointerEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} className="outline-none" />
              {i % every === 0 && <text x={L + band * i + band / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--viz-muted)">{dm(d.date)}</text>}
            </g>
          ))}
        </svg>
        {h && hover !== null && (
          <div className="pointer-events-none absolute top-0 rounded-md border bg-popover px-2 py-1 text-xs shadow-sm"
            style={{ left: `${((L + band * hover + band / 2) / W) * 100}%`, transform: "translateX(-50%)" }}>
            <div className="font-semibold tabular-nums">{usd(h.netSales)}</div>
            <div className="text-muted-foreground">{h.date} · {h.orders} orders</div>
          </div>
        )}
      </div>
      <div className="print:hidden">
        <Button variant="ghost" size="sm" onClick={() => setTable((t) => !t)}>{table ? "Hide table" : "Show as table"}</Button>
      </div>
      {table && (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-muted-foreground"><th className="py-1">Date</th><th className="text-right">Orders</th><th className="text-right">Net sales</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.date} className="border-t"><td className="py-1">{d.date}</td><td className="text-right tabular-nums">{d.orders}</td><td className="text-right tabular-nums">{usd(d.netSales)}</td></tr>)}</tbody>
        </table>
      )}
    </figure>
  );
}
