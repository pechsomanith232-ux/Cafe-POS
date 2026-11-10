import { usd } from "@/lib/format";

/**
 * Branch comparison as horizontal bars (one measure, one hue; each bar is
 * labelled with its value, so identity never rests on color). Negative values
 * draw as an empty bar with the value shown.
 */
export function BranchBars({ title, rows }: { title: string; rows: { branch: string; value: string }[] }) {
  const max = Math.max(...rows.map((r) => Number(r.value)), 0) || 1;
  return (
    <figure className="grid gap-2">
      <figcaption className="text-sm font-medium">{title}</figcaption>
      <ul className="grid gap-2">
        {rows.map((r) => (
          <li key={r.branch} className="grid grid-cols-[8rem_1fr_6rem] items-center gap-3 text-sm">
            <span className="truncate">{r.branch}</span>
            <span className="h-5 rounded-sm" style={{ background: "var(--viz-grid)" }}>
              <span className="block h-5 rounded-r-[4px]" style={{ width: `${Math.max(0, (Number(r.value) / max) * 100)}%`, background: "var(--viz-series-1)" }} />
            </span>
            <span className="text-right tabular-nums">{usd(r.value)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
