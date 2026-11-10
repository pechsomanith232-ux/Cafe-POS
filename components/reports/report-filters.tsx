"use client";

import { Printer } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addDays } from "@/lib/dates";

export type FilterSelect = { name: string; label: string; value: string; options: { value: string; label: string }[]; width?: string };

/**
 * Report filter bar: branch (or "All branches"), date range with quick ranges,
 * extra selects, and Print. Everything lives in the URL so reports are linkable.
 * Hidden when printing; the report header prints the chosen scope instead.
 */
export function ReportFilters({
  branch, branches, canAll, from, to, today, dates = "range", asOf, selects = [],
}: {
  branch: string;
  branches: { id: string; name: string }[];
  canAll: boolean;
  from?: string;
  to?: string;
  today: string;
  /** "range" = from/to, "asOf" = one date, "none" = no dates. */
  dates?: "range" | "asOf" | "none";
  asOf?: string;
  selects?: FilterSelect[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const go = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.push(`${pathname}?${next.toString()}`);
  };
  const monthStart = `${today.slice(0, 8)}01`;
  const quick: [string, string, string][] = [
    ["Today", today, today],
    ["Yesterday", addDays(today, -1), addDays(today, -1)],
    ["7 days", addDays(today, -6), today],
    ["30 days", addDays(today, -29), today],
    ["This month", monthStart, today],
  ];
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
      {(branches.length > 1 || canAll) && (
        <Select value={branch} onValueChange={(v) => go({ branch: v })}>
          <SelectTrigger className="w-44" aria-label="Branch"><SelectValue /></SelectTrigger>
          <SelectContent>
            {canAll && <SelectItem value="all">All branches</SelectItem>}
            {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {selects.map((s) => (
        <Select key={s.name} value={s.value} onValueChange={(v) => go({ [s.name]: v })}>
          <SelectTrigger className={s.width ?? "w-44"} aria-label={s.label}><SelectValue placeholder={s.label} /></SelectTrigger>
          <SelectContent>
            {s.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      ))}
      {dates === "range" && (
        <>
          <Input key={`f${from}`} type="date" className="w-40" aria-label="From" defaultValue={from} max={to} onChange={(e) => e.target.value && go({ from: e.target.value })} />
          <span className="text-sm text-muted-foreground">to</span>
          <Input key={`t${to}`} type="date" className="w-40" aria-label="To" defaultValue={to} min={from} onChange={(e) => e.target.value && go({ to: e.target.value })} />
          <div className="flex flex-wrap gap-1">
            {quick.map(([label, f, t]) => (
              <Button key={label} size="sm" variant={f === from && t === to ? "secondary" : "ghost"} onClick={() => go({ from: f, to: t })}>{label}</Button>
            ))}
          </div>
        </>
      )}
      {dates === "asOf" && (
        <label className="flex items-center gap-2 text-sm">
          As of
          <Input key={`a${asOf}`} type="date" className="w-40" defaultValue={asOf} max={today} onChange={(e) => e.target.value && go({ asOf: e.target.value })} />
        </label>
      )}
      <Button variant="outline" className="ml-auto" onClick={() => window.print()}><Printer /> Print</Button>
    </div>
  );
}
