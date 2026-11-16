"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usd } from "@/lib/format";
import type { CustomerRow } from "@/lib/queries/customers";
import { CustomerDialog } from "./customer-dialog";

export function CustomersTable({ rows, canManage }: { rows: CustomerRow[]; canManage: boolean }) {
  const [editing, setEditing] = useState<CustomerRow | null | "new">(null);
  const columns: ColumnDef<CustomerRow, unknown>[] = [
    { accessorKey: "name", header: "Customer", cell: ({ row: { original: c } }) => <Link className="font-medium hover:underline" href={`/customers/${c.id}`}>{c.name} {!c.isActive && <Badge variant="outline">Inactive</Badge>}</Link> },
    { accessorKey: "phone", header: "Phone", cell: ({ row }) => row.original.phone ?? "—" },
    { id: "limit", header: "Credit limit", accessorFn: (r) => Number(r.creditLimit ?? -1), cell: ({ row }) => (row.original.creditLimit === null ? <span className="text-muted-foreground">No account</span> : usd(row.original.creditLimit)), meta: { className: "text-right" } },
    { id: "balance", header: "Owes", accessorFn: (r) => Number(r.balance), cell: ({ row }) => <span className={Number(row.original.balance) > 0 ? "font-medium" : ""}>{usd(row.original.balance)}</span>, meta: { className: "text-right" } },
    { id: "credit", header: "Credit", accessorFn: (r) => Number(r.credit), cell: ({ row }) => (Number(row.original.credit) > 0 ? usd(row.original.credit) : "—"), meta: { className: "text-right" } },
    { id: "edit", header: "", enableSorting: false, cell: ({ row }) => canManage && <Button variant="ghost" size="icon" aria-label={`Edit ${row.original.name}`} onClick={() => setEditing(row.original)}><Pencil /></Button> },
  ];
  return (
    <>
      <DataTable columns={columns} data={rows} searchPlaceholder="Search customers" emptyText="No customers yet."
        csv={{ filename: "customers.csv", columns: [{ header: "Customer", value: (r) => r.name }, { header: "Phone", value: (r) => r.phone }, { header: "Credit limit", value: (r) => r.creditLimit }, { header: "Owes", value: (r) => r.balance }, { header: "Credit", value: (r) => r.credit }] }}
        toolbar={<>
          <Button asChild variant="outline"><Link href="/customers/aging">AR aging</Link></Button>
          {canManage && <Button onClick={() => setEditing("new")}><Plus /> New customer</Button>}
        </>} />
      {editing && <CustomerDialog customer={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
