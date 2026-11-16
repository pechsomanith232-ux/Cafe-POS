"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MOVEMENT_TYPES } from "@/lib/domain/wac";
import { fmtDateTime, MOVEMENT_LABELS, num, usd } from "@/lib/format";
import type { MovementRow } from "@/lib/queries/inventory";

const ALL = "__all__";
type Filters = { itemId?: string; type?: string; from?: string; to?: string };

function refLink(r: MovementRow) {
  if (r.refType === "stock_adjustment" && r.refId) return <Link className="underline" href={`/inventory/adjustments/${r.refId}`}>Adjustment</Link>;
  if (r.refType === "stock_count" && r.refId) return <Link className="underline" href={`/inventory/counts/${r.refId}`}>Count</Link>;
  if (r.refType === "order_line") return "Sale";
  if (r.refType === "refund_line" || r.refType === "refund") return "Refund";
  if (r.refType === "stock_transfer" && r.refId) return <Link className="underline" href={`/inventory/transfers/${r.refId}`}>Transfer</Link>;
  return r.refType ?? "";
}

export function MovementsTable({ rows, items, filters, showCost }: { rows: MovementRow[]; items: { id: string; name: string }[]; filters: Filters; showCost: boolean }) {
  const router = useRouter();
  const go = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    const q = new URLSearchParams();
    if (next.itemId) q.set("item", next.itemId);
    if (next.type) q.set("type", next.type);
    if (next.from) q.set("from", next.from);
    if (next.to) q.set("to", next.to);
    router.push(`/inventory/movements?${q}`);
  };

  const columns = useMemo<ColumnDef<MovementRow, unknown>[]>(() => {
    const cols: ColumnDef<MovementRow, unknown>[] = [
      { id: "when", header: "When", accessorFn: (r) => r.createdAt.getTime(), cell: ({ row }) => <span className="whitespace-nowrap">{fmtDateTime(row.original.createdAt)}</span> },
      { accessorKey: "itemName", header: "Item", cell: ({ row }) => <Link className="hover:underline" href={`/inventory/items/${row.original.itemId}`}>{row.original.itemName}</Link> },
      { accessorKey: "movementType", header: "Type", cell: ({ row }) => <Badge variant="secondary">{MOVEMENT_LABELS[row.original.movementType] ?? row.original.movementType}</Badge> },
      {
        id: "qty",
        header: "Change",
        accessorFn: (r) => Number(r.qtyBase),
        cell: ({ row }) => {
          const r = row.original;
          const positive = Number(r.qtyBase) > 0;
          return (
            <span className={positive ? "text-emerald-600" : "text-destructive"}>
              {positive ? "+" : ""}{num(r.qtyBase)} {r.baseUnit}
              {r.enteredUnitLabel && r.enteredUnitLabel !== r.baseUnit && <span className="block text-xs text-muted-foreground">entered {num(r.enteredQty)} {r.enteredUnitLabel}</span>}
            </span>
          );
        },
        meta: { className: "text-right" },
      },
      { id: "balance", header: "Balance", accessorFn: (r) => Number(r.qtyAfter), cell: ({ row }) => `${num(row.original.qtyAfter)} ${row.original.baseUnit}`, meta: { className: "text-right" } },
    ];
    if (showCost) {
      cols.push(
        { id: "unitCost", header: "Unit cost", accessorFn: (r) => Number(r.unitCost), cell: ({ row }) => usd(row.original.unitCost, 6), meta: { className: "text-right" } },
        { id: "total", header: "Value", accessorFn: (r) => Number(r.totalCost), cell: ({ row }) => usd(row.original.totalCost), meta: { className: "text-right" } },
      );
    }
    cols.push(
      { accessorKey: "userName", header: "By", cell: ({ getValue }) => (getValue() as string) ?? "—" },
      { id: "ref", header: "Source / reason", enableSorting: false, cell: ({ row }) => <span className="text-sm">{refLink(row.original)} {row.original.reason && <span className="text-muted-foreground">{row.original.reason}</span>}</span> },
    );
    return cols;
  }, [showCost]);

  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Search this page"
      pageSize={100}
      emptyText="No movements match."
      csv={{
        filename: "stock-movements.csv",
        columns: [
          { header: "When", value: (r) => r.createdAt.toISOString() },
          { header: "Item", value: (r) => r.itemName },
          { header: "Type", value: (r) => r.movementType },
          { header: "Qty (base)", value: (r) => r.qtyBase },
          { header: "Base unit", value: (r) => r.baseUnit },
          { header: "Entered qty", value: (r) => r.enteredQty },
          { header: "Entered unit", value: (r) => r.enteredUnitLabel },
          { header: "Balance after", value: (r) => r.qtyAfter },
          ...(showCost ? [{ header: "Unit cost", value: (r: MovementRow) => r.unitCost }, { header: "Value", value: (r: MovementRow) => r.totalCost }] : []),
          { header: "By", value: (r) => r.userName },
          { header: "Reason", value: (r) => r.reason },
        ],
      }}
      toolbar={
        <>
          <Select value={filters.itemId ?? ALL} onValueChange={(v) => go({ itemId: v === ALL ? undefined : v })}>
            <SelectTrigger className="w-48" aria-label="Item"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All items</SelectItem>
              {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.type ?? ALL} onValueChange={(v) => go({ type: v === ALL ? undefined : v })}>
            <SelectTrigger className="w-40" aria-label="Type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All types</SelectItem>
              {MOVEMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{MOVEMENT_LABELS[t]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" className="w-40" aria-label="From" defaultValue={filters.from} onChange={(e) => go({ from: e.target.value || undefined })} />
          <Input type="date" className="w-40" aria-label="To" defaultValue={filters.to} onChange={(e) => go({ to: e.target.value || undefined })} />
        </>
      }
    />
  );
}
