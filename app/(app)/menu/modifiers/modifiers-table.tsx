"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import Link from "next/link";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ModifierGroupRow } from "@/lib/queries/menu";

const rule = (g: ModifierGroupRow) => (g.isRequired ? `Choose ${g.minSelect === g.maxSelect ? g.minSelect : `${g.minSelect}–${g.maxSelect}`}` : `Up to ${g.maxSelect}`);

const columns: ColumnDef<ModifierGroupRow, unknown>[] = [
  {
    accessorKey: "name",
    header: "Group",
    cell: ({ row: { original: g } }) => (
      <Link className="font-medium hover:underline" href={`/menu/modifiers/${g.id}`}>{g.name} {!g.isActive && <Badge variant="outline">Inactive</Badge>}</Link>
    ),
  },
  { id: "rule", header: "Rule", accessorFn: rule, cell: ({ row }) => <span>{rule(row.original)} {row.original.isRequired && <Badge variant="secondary">Required</Badge>}</span> },
  { accessorKey: "modifierCount", header: "Options", meta: { className: "text-right" } },
  { accessorKey: "productCount", header: "Used by products", meta: { className: "text-right" } },
];

export function ModifiersTable({ rows, canEdit, showInactive }: { rows: ModifierGroupRow[]; canEdit: boolean; showInactive: boolean }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Search modifier groups"
      emptyText="No modifier groups yet."
      csv={{
        filename: "modifier-groups.csv",
        columns: [
          { header: "Group", value: (r) => r.name }, { header: "Min", value: (r) => r.minSelect }, { header: "Max", value: (r) => r.maxSelect },
          { header: "Options", value: (r) => r.modifierCount }, { header: "Products", value: (r) => r.productCount }, { header: "Active", value: (r) => (r.isActive ? "yes" : "no") },
        ],
      }}
      toolbar={
        <>
          <Button asChild variant="ghost"><Link href={showInactive ? "/menu/modifiers" : "/menu/modifiers?show=all"}>{showInactive ? "Hide inactive" : "Show inactive"}</Link></Button>
          {canEdit && <Button asChild><Link href="/menu/modifiers/new"><Plus /> New group</Link></Button>}
        </>
      }
    />
  );
}
