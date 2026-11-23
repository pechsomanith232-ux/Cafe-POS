import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type Kpi = {
  label: string;
  value: string;
  icon: LucideIcon;
  /** Comparison line, e.g. "+12% vs yesterday"; `up` picks the color and arrow. */
  delta?: { text: string; up: boolean | null };
  /** Muted line shown when there is no comparison. */
  hint?: string;
  /** Dim the value (e.g. nothing sold yet today). */
  empty?: boolean;
};

/** Dashboard KPI row: four cards with an icon chip, label, big value and a comparison or hint line. */
export function KpiCards({ items }: { items: Kpi[] }) {
  return (
    <dl className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
      {items.map(({ label, value, icon: Icon, delta, hint, empty }) => (
        <div key={label} className="flex flex-col gap-3 rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="size-4.5" />
            </span>
            <dt className="text-sm text-muted-foreground">{label}</dt>
          </div>
          <dd className={cn("text-2xl font-semibold tracking-tight tabular-nums", empty && "text-muted-foreground")}>{value}</dd>
          {delta ? (
            <dd className={cn("flex items-center gap-1 text-xs font-medium",
              delta.up === true && "text-success", delta.up === false && "text-destructive", delta.up === null && "text-muted-foreground")}>
              {delta.up === true && <ArrowUpRight className="size-3.5" />}
              {delta.up === false && <ArrowDownRight className="size-3.5" />}
              {delta.text}
            </dd>
          ) : hint ? (
            <dd className="text-xs text-muted-foreground">{hint}</dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
