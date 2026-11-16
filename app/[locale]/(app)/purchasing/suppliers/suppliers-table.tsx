"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SupplierDialog } from "@/components/purchasing/supplier-dialog";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usd } from "@/lib/format";
import type { SupplierRow } from "@/lib/queries/purchasing";

const columns: ColumnDef<SupplierRow, unknown>[] = [
  {
    accessorKey: "name",
    header: "Supplier",
    cell: ({ row }) => (
      <Link className="font-medium hover:underline" href={`/purchasing/suppliers/${row.original.id}`}>
        {row.original.name} {!row.original.isActive && <Badge variant="outline">Inactive</Badge>}
      </Link>
    ),
  },
  { accessorKey: "contactName", header: "Contact", cell: ({ getValue }) => (getValue() as string) ?? "—" },
  { accessorKey: "phone", header: "Phone", cell: ({ getValue }) => (getValue() as string) ?? "—" },
  { accessorKey: "paymentTermsDays", header: "Terms", cell: ({ getValue }) => `${getValue()} days` },
  { id: "owed", header: "Owed", accessorFn: (r) => Number(r.owed), cell: ({ row }) => usd(row.original.owed), meta: { className: "text-right" } },
  { id: "credit", header: "Credit", accessorFn: (r) => Number(r.credit), cell: ({ row }) => (Number(row.original.credit) > 0 ? usd(row.original.credit) : "—"), meta: { className: "text-right" } },
];

export function SuppliersTable({ suppliers, canEdit, showInactive }: { suppliers: SupplierRow[]; canEdit: boolean; showInactive: boolean }) {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <DataTable
        columns={columns}
        data={suppliers}
        searchPlaceholder="Search suppliers"
        emptyText="No suppliers yet."
        csv={{
          filename: "suppliers.csv",
          columns: [
            { header: "Name", value: (r) => r.name }, { header: "Contact", value: (r) => r.contactName }, { header: "Phone", value: (r) => r.phone },
            { header: "Email", value: (r) => r.email }, { header: "Terms (days)", value: (r) => r.paymentTermsDays }, { header: "Owed", value: (r) => r.owed }, { header: "Credit", value: (r) => r.credit },
          ],
        }}
        toolbar={
          <>
            <Button asChild variant="ghost"><Link href={showInactive ? "/purchasing/suppliers" : "/purchasing/suppliers?show=all"}>{showInactive ? "Hide inactive" : "Show inactive"}</Link></Button>
            {canEdit && <Button onClick={() => setAdding(true)}><Plus /> New supplier</Button>}
          </>
        }
      />
      {adding && <SupplierDialog supplier={null} onClose={() => setAdding(false)} />}
    </>
  );
}
