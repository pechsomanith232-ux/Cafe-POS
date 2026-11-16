"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usd } from "@/lib/format";
import type { ReceiptRow } from "@/lib/queries/purchasing";

const label = (n: number) => `GR-${String(n).padStart(6, "0")}`;
const PAY: Record<string, string> = { unpaid: "Unpaid", partial: "Part paid", paid: "Paid" };

const columns: ColumnDef<ReceiptRow, unknown>[] = [
  { id: "no", header: "Receipt", accessorFn: (r) => r.number, cell: ({ row }) => <Link className="font-medium hover:underline" href={`/purchasing/receipts/${row.original.id}`}>{label(row.original.number)}</Link> },
  { accessorKey: "receiptDate", header: "Date" },
  { accessorKey: "purchaseType", header: "Type", cell: ({ getValue }) => <Badge variant="outline">{getValue() === "direct" ? "Direct" : "Credit"}</Badge> },
  { accessorKey: "supplierName", header: "Supplier", cell: ({ getValue }) => (getValue() as string) ?? "—" },
  { accessorKey: "supplierInvoiceNo", header: "Invoice no.", cell: ({ getValue }) => (getValue() as string) ?? "—" },
  { id: "total", header: "Total", accessorFn: (r) => Number(r.total), cell: ({ row }) => usd(row.original.total), meta: { className: "text-right" } },
  {
    id: "status", header: "Status", accessorFn: (r) => r.status + r.paymentStatus,
    cell: ({ row }) => row.original.status === "draft"
      ? <Badge variant="outline">Draft</Badge>
      : <Badge variant={row.original.paymentStatus === "paid" ? "secondary" : "default"}>{PAY[row.original.paymentStatus]}{row.original.paymentStatus !== "paid" ? ` · ${usd(row.original.amountDue)} due` : ""}</Badge>,
  },
  { accessorKey: "dueDate", header: "Due", cell: ({ getValue }) => (getValue() as string) ?? "—" },
];

export function ReceiptsTable({ rows, type }: { rows: ReceiptRow[]; type?: string }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Search supplier, invoice no."
      emptyText="No receipts yet."
      csv={{
        filename: "goods-receipts.csv",
        columns: [
          { header: "Receipt", value: (r) => label(r.number) }, { header: "Date", value: (r) => r.receiptDate }, { header: "Type", value: (r) => r.purchaseType },
          { header: "Supplier", value: (r) => r.supplierName }, { header: "Invoice no.", value: (r) => r.supplierInvoiceNo }, { header: "Status", value: (r) => r.status },
          { header: "Total", value: (r) => r.total }, { header: "Amount due", value: (r) => r.amountDue }, { header: "Payment", value: (r) => r.paymentStatus }, { header: "Due date", value: (r) => r.dueDate },
        ],
      }}
      toolbar={
        <div className="flex gap-1">
          {[["All", undefined], ["Credit", "credit"], ["Direct", "direct"]].map(([l, t]) => (
            <Button key={l} asChild size="sm" variant={type === t ? "default" : "outline"}><Link href={t ? `/purchasing/receipts?type=${t}` : "/purchasing/receipts"}>{l}</Link></Button>
          ))}
        </div>
      }
    />
  );
}
