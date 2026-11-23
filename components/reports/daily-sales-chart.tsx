"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
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

/** Tracks an element's width so the SVG draws at real pixels (text never stretches). */
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/**
 * Daily net sales as columns (single series, so no legend: the title names it).
 * Bars use the brand chart color with a small rounded data end and a max
 * width; each bar is its own hover/focus target with a tooltip; a table view
 * mirrors the data. Set `captionHidden` when a card header already shows the title.
 */
export function DailySalesChart({ data, title, height = 300, captionHidden = false }: {
  data: Point[]; title: string; height?: number; captionHidden?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const [box, W] = useWidth(640);
  const titleId = useId();
  const t = useTranslations("Dashboard.chart");
  const H = height, L = 56, R = 8, T = 16, B = 28;
  const vals = data.map((d) => Number(d.netSales));
  const tk = ticks(Math.min(...vals, 0), Math.max(...vals, 0));
  const y0 = tk[0], y1 = tk[tk.length - 1];
  const y = (v: number) => T + (H - T - B) * (1 - (v - y0) / (y1 - y0 || 1));
  const band = (W - L - R) / Math.max(data.length, 1);
  const bw = Math.min(32, Math.max(2, band * 0.6));
  const r = Math.min(4, bw / 2);
  const every = Math.ceil(data.length / Math.max(2, Math.floor((W - L - R) / 56)));

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
      <figcaption id={titleId} className={captionHidden ? "sr-only" : "text-sm font-medium"}>{title}</figcaption>
      <p id={`${titleId}-sum`} className="sr-only">
        {t("summary", { total: usd(vals.reduce((a, v) => a + v, 0)), high: usd(Math.max(...vals, 0)), low: usd(Math.min(...vals, 0)) })}
      </p>
      <div ref={box} className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="group" aria-labelledby={titleId} aria-describedby={`${titleId}-sum`} onPointerLeave={() => setHover(null)}>
          {tk.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth={1} strokeDasharray={v === 0 ? undefined : "3 3"} />
              <text x={L - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize={12} fill="var(--muted-foreground)">{tickLabel(v)}</text>
            </g>
          ))}
          {data.map((d, i) => (
            <g key={d.date}>
              {hover === i && <rect x={L + band * i} y={T} width={band} height={H - T - B} fill="var(--muted)" rx={4} />}
              <path d={bar(i, vals[i])} fill="var(--chart-1)" opacity={hover === null || hover === i ? 1 : 0.6} />
              {/* Hit target: the whole band, taller than the bar. */}
              <rect role="img" x={L + band * i} y={T} width={band} height={H - T - B} fill="transparent" tabIndex={0}
                aria-label={t("bar", { date: d.date, amount: usd(d.netSales), orders: String(d.orders) })}
                onPointerEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} className="outline-none" />
              {i % every === 0 && <text x={L + band * i + band / 2} y={H - 8} textAnchor="middle" fontSize={12} fill="var(--muted-foreground)">{dm(d.date)}</text>}
            </g>
          ))}
        </svg>
        {h && hover !== null && (
          <div className="pointer-events-none absolute z-10 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
            style={{ left: `${((L + band * hover + band / 2) / W) * 100}%`, top: Math.max(0, y(Math.max(0, vals[hover])) - 56), transform: "translateX(-50%)" }}>
            <div className="text-sm font-semibold tabular-nums">{usd(h.netSales)}</div>
            <div className="whitespace-nowrap text-muted-foreground">{t("tooltip", { date: h.date, orders: String(h.orders) })}</div>
          </div>
        )}
      </div>
      <div className="print:hidden">
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setTable((t) => !t)}>{table ? t("hideTable") : t("showTable")}</Button>
      </div>
      {table && (
        <table className="w-full text-sm">
          <thead><tr className="text-start text-muted-foreground"><th className="py-1 text-start">{t("date")}</th><th className="text-end">{t("orders")}</th><th className="text-end">{t("netSales")}</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.date} className="border-t"><td className="py-1">{d.date}</td><td className="text-end tabular-nums">{d.orders}</td><td className="text-end tabular-nums">{usd(d.netSales)}</td></tr>)}</tbody>
        </table>
      )}
    </figure>
  );
}
