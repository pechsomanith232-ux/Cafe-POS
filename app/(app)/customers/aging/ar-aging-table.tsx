"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/shared/data-table";
import { Input } from "@/components/ui/input";
import { usd } from "@/lib/format";
import type { arAging } from "@/lib/queries/customers";

type Data = Awaited<ReturnType<typeof arAging>>;
type Row = Data["rows"][number];
const BUCKETS = [["current", "Current"], ["d1_30", "1–30"], ["d31_60", "31–60"], ["d61_90", "61–90"], ["d90_plus", "90+"], ["total", "Total"]] as const;

export function ArAgingTable({ data }: { data: Data }) {
  const router = useRouter();
  const columns: ColumnDef<Row, unknown>[] = [
    { accessorKey: "customerName", header: "Customer" },
    ...BUCKETS.map(([k, label]) => ({ id: k, header: label, accessorFn: (r: Row) => Number(r[k]), cell: ({ row }: { row: { original: Row } }) => usd(row.original[k]), meta: { className: "text-right" } })),
  ];
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2 text-sm">
        As of <Input type="date" className="w-44" aria-label="As of" defaultValue={data.asOf} onChange={(e) => e.target.value && router.push(`/customers/aging?asOf=${e.target.value}`)} />
        <span className="ml-auto">Total owed <b>{usd(data.totals.total)}</b></span>
      </div>
      <DataTable columns={columns} data={data.rows} searchPlaceholder="Search customers" emptyText="Nobody owes anything."
        csv={{ filename: `ar-aging-${data.asOf}.csv`, columns: [{ header: "Customer", value: (r) => r.customerName }, ...BUCKETS.map(([k, label]) => ({ header: label, value: (r: Row) => r[k] }))] }} />
    </div>
  );
}
