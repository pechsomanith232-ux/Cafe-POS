"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { DataTable } from "@/components/shared/data-table";
import { fmtDateTime, num, usd } from "@/lib/format";

/** A serializable column, so server pages can describe tables without passing functions. */
export type ReportColumn = {
  key: string;
  header: string;
  kind?: "text" | "money" | "unitCost" | "qty" | "int" | "pct" | "datetime" | "bool";
  /** Link the cell: `${prefix}${row[key]}${suffix}`. */
  link?: { prefix: string; key: string; suffix?: string };
  /** Map raw values to display labels (e.g. reason codes). */
  labels?: Record<string, string>;
};

type Row = Record<string, unknown>;

function display(c: ReportColumn, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (c.labels && typeof v === "string") return c.labels[v] ?? v;
  switch (c.kind) {
    case "money": return usd(v as string);
    case "unitCost": return usd(v as string, 4);
    case "qty": return num(v as string);
    case "int": return String(v);
    case "pct": return `${num(v as string, 2)}%`;
    case "datetime": return fmtDateTime(new Date(v as string));
    case "bool": return v ? "Yes" : "No";
    default: return String(v);
  }
}

const numeric = (c: ReportColumn) => c.kind === "money" || c.kind === "unitCost" || c.kind === "qty" || c.kind === "int" || c.kind === "pct";

/** Report table: sortable, searchable, CSV export, and prints every row (no paging). */
export function ReportTable({ columns, data, filename, emptyText = "Nothing in this period.", searchPlaceholder = "Search" }: {
  columns: ReportColumn[];
  data: Row[];
  filename: string;
  emptyText?: string;
  searchPlaceholder?: string;
}) {
  const defs: ColumnDef<Row, unknown>[] = columns.map((c) => ({
    id: c.key,
    header: c.header,
    accessorFn: (r) => (numeric(c) ? Number(r[c.key] ?? 0) : String(r[c.key] ?? "")),
    cell: ({ row }) => {
      const text = display(c, row.original[c.key]);
      const target = c.link && row.original[c.link.key];
      return target ? <Link className="underline underline-offset-2" href={`${c.link!.prefix}${String(target)}${c.link!.suffix ?? ""}`}>{text}</Link> : text;
    },
    meta: { className: numeric(c) ? "text-right tabular-nums" : undefined },
  }));
  return (
    <DataTable columns={defs} data={data} pageSize={5000} emptyText={emptyText} searchPlaceholder={searchPlaceholder}
      csv={{ filename, columns: columns.map((c) => ({ header: c.header, value: (r: Row) => {
        const v = r[c.key];
        if (c.labels && typeof v === "string") return c.labels[v] ?? v;
        if (c.kind === "bool") return v ? "Yes" : "No";
        return v as string | number | null | undefined;
      } })) }} />
  );
}
