"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ImageIcon, Plus } from "lucide-react";
import Link from "next/link";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usd } from "@/lib/format";
import type { ProductRow } from "@/lib/queries/menu";

type Row = ProductRow & { imageUrl: string | null };

const price = (r: Row) => (r.minPrice === null ? "—" : r.minPrice === r.maxPrice ? usd(r.minPrice) : `${usd(r.minPrice)} – ${usd(r.maxPrice)}`);
const STATION: Record<string, string> = { bar: "Bar", kitchen: "Kitchen", none: "—" };

const columns: ColumnDef<Row, unknown>[] = [
  {
    accessorKey: "name",
    header: "Product",
    cell: ({ row: { original: r } }) => (
      <Link className="flex items-center gap-3 font-medium hover:underline" href={`/menu/products/${r.id}`}>
        <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element -- served by our own route or the bucket */}
          {r.imageUrl ? <img src={r.imageUrl} alt="" className="size-full object-cover" /> : <ImageIcon className="size-4 text-muted-foreground" />}
        </span>
        {r.name}
      </Link>
    ),
  },
  { id: "category", header: "Category", accessorFn: (r) => r.categoryName ?? "", cell: ({ row }) => row.original.categoryName ?? "—" },
  { accessorKey: "variantCount", header: "Variants", meta: { className: "text-right" } },
  { id: "price", header: "Price", accessorFn: (r) => Number(r.minPrice ?? 0), cell: ({ row }) => price(row.original), meta: { className: "text-right" } },
  { id: "station", header: "Station", accessorFn: (r) => r.kitchenStation, cell: ({ row }) => STATION[row.original.kitchenStation] },
  {
    id: "badges",
    header: "",
    enableSorting: false,
    cell: ({ row: { original: r } }) => (
      <div className="flex flex-wrap gap-1">
        {r.noStockDeduction && <Badge variant="secondary">No stock deduction</Badge>}
        {!r.hasRecipe && <Badge variant="outline" className="border-amber-500 text-amber-700">No recipe</Badge>}
        {!r.isActive && <Badge variant="outline">Inactive</Badge>}
      </div>
    ),
  },
];

export function ProductsTable({ rows, canEdit }: { rows: Row[]; canEdit: boolean }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Search products"
      emptyText="No products yet."
      csv={{
        filename: "products.csv",
        columns: [
          { header: "Product", value: (r) => r.name }, { header: "Category", value: (r) => r.categoryName }, { header: "Variants", value: (r) => r.variantCount },
          { header: "Min price", value: (r) => r.minPrice }, { header: "Max price", value: (r) => r.maxPrice }, { header: "Station", value: (r) => r.kitchenStation },
          { header: "Deducts stock", value: (r) => (r.noStockDeduction ? "no" : "yes") }, { header: "Has recipe", value: (r) => (r.hasRecipe ? "yes" : "no") },
          { header: "Active", value: (r) => (r.isActive ? "yes" : "no") },
        ],
      }}
      toolbar={canEdit && <Button asChild><Link href="/menu/products/new"><Plus /> New product</Link></Button>}
    />
  );
}
