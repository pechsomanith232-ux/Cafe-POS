"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createMenuCategoryAction, updateMenuCategoryAction } from "@/app/(app)/menu/actions";
import { DataTable } from "@/components/shared/data-table";
import { Field } from "@/components/shared/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { MenuCategoryRow } from "@/lib/queries/menu";

function CategoryDialog({ category, onClose }: { category: MenuCategoryRow | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(category?.name ?? "");
  const [color, setColor] = useState(category?.color ?? "#7c3aed");
  const [sortOrder, setSortOrder] = useState(String(category?.sortOrder ?? 0));
  const [isActive, setIsActive] = useState(category?.isActive ?? true);
  const save = () =>
    start(async () => {
      const input = { name, color, sortOrder: Number(sortOrder) || 0 };
      const r = category ? await updateMenuCategoryAction(category.id, { ...input, isActive }) : await createMenuCategoryAction(input);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Category saved.");
      onClose();
      router.refresh();
    });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{category ? `Edit ${category.name}` : "New menu category"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Coffee" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Colour"><Input type="color" aria-label="Colour" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 p-1" /></Field>
            <Field label="Sort order"><Input inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></Field>
          </div>
          {category && <div className="flex items-center gap-3"><Switch id="c-active" checked={isActive} onCheckedChange={setIsActive} /><Label htmlFor="c-active">Active</Label></div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CategoriesTable({ rows, canEdit }: { rows: MenuCategoryRow[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<MenuCategoryRow | null | "new">(null);
  const columns: ColumnDef<MenuCategoryRow, unknown>[] = [
    {
      accessorKey: "name",
      header: "Category",
      cell: ({ row: { original: c } }) => (
        <span className="flex items-center gap-2 font-medium">
          <span className="size-3 rounded-full border" style={{ background: c.color ?? "transparent" }} />{c.name}
          {!c.isActive && <Badge variant="outline">Inactive</Badge>}
        </span>
      ),
    },
    { accessorKey: "sortOrder", header: "Sort", meta: { className: "text-right" } },
    { accessorKey: "productCount", header: "Products", meta: { className: "text-right" } },
    {
      id: "edit", header: "", enableSorting: false,
      cell: ({ row }) => canEdit && <Button variant="ghost" size="icon" aria-label={`Edit ${row.original.name}`} onClick={() => setEditing(row.original)}><Pencil /></Button>,
    },
  ];
  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        searchPlaceholder="Search categories"
        emptyText="No menu categories yet."
        csv={{ filename: "menu-categories.csv", columns: [{ header: "Category", value: (r) => r.name }, { header: "Sort", value: (r) => r.sortOrder }, { header: "Products", value: (r) => r.productCount }, { header: "Active", value: (r) => (r.isActive ? "yes" : "no") }] }}
        toolbar={canEdit && <Button onClick={() => setEditing("new")}><Plus /> New category</Button>}
      />
      {editing && <CategoryDialog category={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
