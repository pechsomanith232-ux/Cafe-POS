"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Tags } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { createCategoryAction, updateCategoryAction } from "@/app/(app)/inventory/actions";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { dec, sum } from "@/lib/domain/money";
import { breakdown } from "@/lib/domain/units";
import { usd } from "@/lib/format";
import type { ItemListRow } from "@/lib/queries/inventory";

type Category = { id: string; name: string; isActive: boolean };
const ALL = "__all__";

export function ItemsTable({
  items,
  categories,
  lowOnly,
  showInactive,
  canManage,
  canSeeCost,
}: {
  items: ItemListRow[];
  categories: Category[];
  lowOnly: boolean;
  showInactive: boolean;
  canManage: boolean;
  canSeeCost: boolean;
}) {
  const [category, setCategory] = useState(ALL);
  const [managingCategories, setManagingCategories] = useState(false);
  const data = useMemo(() => (category === ALL ? items : items.filter((i) => i.categoryId === category)), [items, category]);

  const stockText = (i: ItemListRow) => breakdown(i.qtyOnHand, i.baseUnit, i.packaging);
  const columns = useMemo<ColumnDef<ItemListRow, unknown>[]>(() => {
    const cols: ColumnDef<ItemListRow, unknown>[] = [
      {
        accessorKey: "name",
        header: "Item",
        cell: ({ row }) => (
          <Link href={`/inventory/items/${row.original.id}`} className="font-medium hover:underline">
            {row.original.name}
            {!row.original.isActive && <Badge variant="outline" className="ml-2">Inactive</Badge>}
          </Link>
        ),
      },
      { accessorKey: "sku", header: "SKU", cell: ({ getValue }) => (getValue() as string) ?? "—" },
      { accessorKey: "categoryName", header: "Category", cell: ({ getValue }) => (getValue() as string) ?? "—" },
      {
        id: "stock",
        header: "On hand",
        accessorFn: (r) => Number(r.qtyOnHand),
        cell: ({ row }) => (
          <span className={dec(row.original.qtyOnHand).isNegative() ? "text-destructive" : undefined}>{stockText(row.original)}</span>
        ),
      },
      {
        id: "reorder",
        header: "Reorder at",
        accessorFn: (r) => (r.reorderLevel === null ? -1 : dec(r.reorderLevel).toNumber()),
        cell: ({ row }) =>
          row.original.reorderLevel === null ? "—" : (
            <span className="inline-flex items-center gap-2">
              {breakdown(row.original.reorderLevel, row.original.baseUnit, row.original.packaging)}
              {row.original.isLow && <Badge variant="destructive">Low</Badge>}
            </span>
          ),
      },
    ];
    if (canSeeCost) {
      cols.push(
        { id: "avg", header: "Avg cost / unit", accessorFn: (r) => Number(r.avgCost), cell: ({ row }) => `${usd(row.original.avgCost, 6)} / ${row.original.baseUnit}`, meta: { className: "text-right" } },
        { id: "value", header: "Stock value", accessorFn: (r) => Number(r.stockValue), cell: ({ row }) => usd(row.original.stockValue), meta: { className: "text-right" } },
      );
    }
    return cols;
  }, [canSeeCost]);

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        searchPlaceholder="Search name or SKU"
        emptyText={lowOnly ? "Nothing is low on stock." : "No items yet."}
        csv={{
          filename: "stock.csv",
          columns: [
            { header: "Item", value: (r) => r.name },
            { header: "SKU", value: (r) => r.sku },
            { header: "Category", value: (r) => r.categoryName },
            { header: "Base unit", value: (r) => r.baseUnit },
            { header: "On hand (base)", value: (r) => r.qtyOnHand },
            { header: "On hand", value: stockText },
            { header: "Reorder level (base)", value: (r) => r.reorderLevel },
            ...(canSeeCost
              ? [
                  { header: "Avg cost per base unit", value: (r: ItemListRow) => r.avgCost },
                  { header: "Stock value", value: (r: ItemListRow) => r.stockValue },
                ]
              : []),
          ],
        }}
        toolbar={
          <>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-44" aria-label="Category"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All categories</SelectItem>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button asChild variant={lowOnly ? "default" : "outline"}>
              <Link href={lowOnly ? "/inventory/items" : "/inventory/items?filter=low"}>Low stock only</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href={showInactive ? "/inventory/items" : "/inventory/items?show=all"}>{showInactive ? "Hide inactive" : "Show inactive"}</Link>
            </Button>
            {canManage && (
              <>
                <Button variant="outline" onClick={() => setManagingCategories(true)}><Tags /> Categories</Button>
                <Button asChild><Link href="/inventory/items/new"><Plus /> New item</Link></Button>
              </>
            )}
          </>
        }
      />
      {canSeeCost && (
        <p className="mt-2 text-right text-sm text-muted-foreground">
          Total stock value: {usd(sum(data.map((i) => i.stockValue ?? "0")).toFixed(2))}
        </p>
      )}
      <CategoriesDialog open={managingCategories} onOpenChange={setManagingCategories} categories={categories} />
    </>
  );
}

function CategoriesDialog({ open, onOpenChange, categories }: { open: boolean; onOpenChange: (o: boolean) => void; categories: Category[] }) {
  const [name, setName] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Item categories</DialogTitle></DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await createCategoryAction(name);
            if (r.ok) { toast.success("Category added."); setName(""); } else toast.error(r.error);
          }}
        >
          <Input placeholder="New category, e.g. Dairy" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" disabled={!name.trim()}>Add</Button>
        </form>
        <div className="grid gap-2">
          {categories.map((c) => (
            <label key={c.id} className="flex items-center justify-between text-sm">
              {c.name}
              <Switch
                checked={c.isActive}
                aria-label={`${c.name} active`}
                onCheckedChange={async (on) => {
                  const r = await updateCategoryAction(c.id, c.name, on);
                  if (!r.ok) toast.error(r.error);
                }}
              />
            </label>
          ))}
          {categories.length === 0 && <p className="text-sm text-muted-foreground">No categories yet.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
